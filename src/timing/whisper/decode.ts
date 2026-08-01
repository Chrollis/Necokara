/**
 * whisper/decode.ts — timestamp-mode greedy decoding for one 30s window.
 *
 * Reproduces whisper/decoding.py GreedyDecoder(T=0) plus the three logit
 * filters (SuppressBlank, SuppressTokens, ApplyTimestampRules) and the
 * no-speech / average-logprob accounting used by transcribe().
 *
 * Pure logic: the caller supplies a `decoderFn` that runs the decoder onnx
 * session and returns the full logits [L, V] as a Float32Array.
 */
import type { WhisperTokenizer } from './tokenizer';

export const TIME_PRECISION = 0.02; // seconds per timestamp token

export interface DecodeOptions {
  task: 'transcribe' | 'translate';
  languageToken: number;
  /** tokens to always suppress (non_speech + specials), computed once by caller */
  suppressTokens: number[];
  /** conditioning prompt tokens from the previous window (without <|startofprev|>) */
  promptTokens?: number[];
  /** lyric furigana prompt tokens (kept near the sot sequence; sliced with conditioning) */
  initialPromptTokens?: number[];
  maxInitialTimestampIndex?: number; // default round(1.0 / TIME_PRECISION) = 50
  sampleLen?: number; // default 112 (n_ctx // 2)
  temperature?: number; // default 0 (greedy)
}

export interface DecodeResult {
  /** generated tokens after the sot sequence (includes timestamps / eot excluded) */
  tokens: number[];
  noSpeechProb: number;
  avgLogprob: number;
  sumLogprob: number;
  temperature: number;
}

const NEG = -1e30;

function logSumExp(a: number, b: number): number {
  if (a === -Infinity) return b;
  if (b === -Infinity) return a;
  if (a > b) return a + Math.log1p(Math.exp(b - a));
  return b + Math.log1p(Math.exp(a - b));
}

function applyTimestampRules(
  fl: Float32Array,
  tokens: number[],
  sampleBegin: number,
  tsBegin: number,
  eot: number,
  noTimestamps: number,
  maxInitialTsIndex: number,
): void {
  fl[noTimestamps] = NEG;
  const sampled = tokens.slice(sampleBegin);
  const lastTs = sampled.length >= 1 && sampled[sampled.length - 1] >= tsBegin;
  const penultTs = sampled.length < 2 || sampled[sampled.length - 2] >= tsBegin;

  if (lastTs) {
    if (penultTs) {
      for (let v = tsBegin; v < fl.length; v++) fl[v] = NEG; // must be text
    } else {
      for (let v = 0; v < eot; v++) fl[v] = NEG; // must be timestamp
    }
  }

  const timestamps = sampled.filter((t) => t >= tsBegin);
  if (timestamps.length > 0) {
    const tsLast =
      lastTs && !penultTs
        ? timestamps[timestamps.length - 1]
        : timestamps[timestamps.length - 1] + 1;
    for (let v = tsBegin; v < tsLast; v++) fl[v] = NEG;
  }

  if (tokens.length === sampleBegin) {
    for (let v = 0; v < tsBegin; v++) fl[v] = NEG; // force a leading timestamp
    const lastAllowed = tsBegin + maxInitialTsIndex;
    for (let v = lastAllowed + 1; v < fl.length; v++) fl[v] = NEG;
  }

  // if the total timestamp probability beats every text token, force a timestamp
  let tsLogsum = -Infinity;
  for (let v = tsBegin; v < fl.length; v++)
    tsLogsum = logSumExp(tsLogsum, fl[v]);
  let maxText = -Infinity;
  for (let v = 0; v < tsBegin; v++) if (fl[v] > maxText) maxText = fl[v];
  if (tsLogsum > maxText) {
    for (let v = 0; v < tsBegin; v++) fl[v] = NEG;
  }
}

/**
 * Decode one window. `decoderFn(inputIds)` must return the full logits tensor
 * as Float32Array shaped [L, V] (row-major).
 */
export async function decodeWindow(
  decoderFn: (inputIds: number[]) => Promise<Float32Array>,
  tokenizer: WhisperTokenizer,
  opts: DecodeOptions,
): Promise<DecodeResult> {
  const sp = tokenizer.specials;
  const tsBegin = sp.timestampBegin;
  const eot = sp.eot;
  const temperature = opts.temperature ?? 0;
  const sampleLen = opts.sampleLen ?? 112;
  const maxInitialTsIndex =
    opts.maxInitialTimestampIndex ?? Math.round(1.0 / TIME_PRECISION);

  const sotSeq = tokenizer.sotSequence(opts.languageToken, opts.task);
  const maxPrompt = Math.floor(448 / 2 - 1) - sotSeq.length;
  // lyric prompt first (kept at the tail so it survives truncation), then
  // previous-window conditioning at the head (older conditioning is dropped first)
  const merged = [
    ...(opts.promptTokens ?? []),
    ...(opts.initialPromptTokens ?? []),
  ];
  let initial: number[];
  if (merged.length > 0) {
    initial = [sp.sotPrev, ...merged.slice(-maxPrompt), ...sotSeq];
  } else {
    initial = [...sotSeq];
  }
  const sampleBegin = initial.length;
  const sotIndex = initial.indexOf(sp.sot);
  const spaceToken = tokenizer.spaceToken();

  let tokens = initial.slice();
  let sumLogprob = 0;
  let noSpeechProb = NaN;

  for (let step = 0; step < sampleLen; step++) {
    const logits = await decoderFn(tokens); // Float32Array [L, V]
    const L = tokens.length;
    const V = logits.length / L;
    // no-speech probability: softmax over logits at the sot position
    if (step === 0 && sp.noSpeech >= 0) {
      const off = sotIndex * V;
      let m = -Infinity;
      for (let v = 0; v < V; v++) {
        const x = logits[off + v];
        if (x > m) m = x;
      }
      let s = 0;
      for (let v = 0; v < V; v++) s += Math.exp(logits[off + v] - m);
      noSpeechProb = Math.exp(logits[off + sp.noSpeech] - m) / s;
    }

    const last = logits.subarray((L - 1) * V, L * V);
    const fl = new Float32Array(last);

    // SuppressBlank: first step suppress ' ' and eot
    if (step === 0) {
      fl[spaceToken] = NEG;
      fl[eot] = NEG;
    }
    // SuppressTokens
    for (const s of opts.suppressTokens) fl[s] = NEG;
    // ApplyTimestampRules
    applyTimestampRules(
      fl,
      tokens,
      sampleBegin,
      tsBegin,
      eot,
      sp.noTimestamps,
      maxInitialTsIndex,
    );

    // greedy selection (temperature 0)
    let best = 0;
    let bv = -Infinity;
    for (let v = 0; v < V; v++) {
      if (fl[v] > bv) {
        bv = fl[v];
        best = v;
      }
    }
    // logprob of the chosen token for avg_logprob accounting
    let m = -Infinity;
    for (let v = 0; v < V; v++) {
      const x = last[v];
      if (x > m) m = x;
    }
    let lse = 0;
    for (let v = 0; v < V; v++) lse += Math.exp(last[v] - m);
    const logProb = last[best] - m - Math.log(lse);

    tokens.push(best);
    sumLogprob += logProb;
    if (best === eot) break;
  }

  const generated = tokens.length - sampleBegin;
  return {
    tokens: tokens.slice(sampleBegin),
    noSpeechProb,
    avgLogprob: generated > 0 ? sumLogprob / generated : sumLogprob,
    sumLogprob,
    temperature,
  };
}
