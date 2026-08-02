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
  maxInitialTimestampIndex?: number; // default round(1.0 / TIME_PRECISION) = 50
  sampleLen?: number; // default 112 (n_ctx // 2)
  temperature?: number; // default 0 (greedy)
  /** if true, run one extra final decoder pass over the complete token sequence
   * and return per-token cross-attention [nTokens, nFrames] for word timestamps */
  needCrossAttn?: boolean;
  /** true when the decoderFn supports KV-cache incremental decoding
   * (first step runs the full sequence, later steps feed 1 token + KV);
   * false runs the whole sequence every step (no with_past model). */
  incremental?: boolean;
}

export interface DecodeResult {
  /** generated tokens after the sot sequence (includes timestamps / eot excluded) */
  tokens: number[];
  noSpeechProb: number;
  avgLogprob: number;
  temperature: number;
  /** per-token cross-attention to encoder frames [nTokens, nFrames], when the
   * model exposes it (word-level timestamps); null otherwise */
  crossAttn?: Float32Array | null;
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
 * Decode one window using KV-cache incremental decoding.
 *
 * `decoderFn(inputIds, kv?)` runs the decoder:
 *   - inputIds.length > 1 → full-sequence pass (no KV); returns ALL logits rows
 *     [L, V] so the caller can read any row (no-speech at the sot position),
 *     plus the initial `kv` and the LAST row's attention.
 *   - inputIds.length === 1 → single-token incremental pass with `kv`; returns
 *     the single next-token logits row [V] and the new `kv`.
 *
 * Returns per-token attention rows accumulated during generation, packed
 * [nGenerated, nFrames] for word-level timestamps.
 */
export async function decodeWindow(
  decoderFn: (
    inputIds: number[],
    kv?: unknown,
  ) => Promise<{
    logits: Float32Array;
    kv?: unknown;
    attn?: Float32Array | null;
  }>,
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
  // previous-window conditioning at the head; older conditioning is dropped
  // first when it exceeds the context budget
  const merged = opts.promptTokens ?? [];
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
  let kv: unknown = null;
  let w = 0; // attention row width (Tenc)
  const crossAttnRows: Float32Array[] = [];
  const incremental = opts.incremental ?? false;

  for (let step = 0; step < sampleLen; step++) {
    // first step always runs the full sequence (reads no-speech + seeds KV).
    // With incremental (with_past) later steps feed 1 token + KV; without it,
    // every step re-runs the whole (growing) sequence.
    const isFirst = step === 0;
    const inputIds = isFirst || !incremental ? tokens : tokens.slice(-1);
    const res = await decoderFn(inputIds, isFirst ? null : kv);
    kv = res.kv ?? null;
    if (res.attn) {
      w = res.attn.length;
      // only keep attention of GENERATED tokens (skip the initial sot rows)
      if (!isFirst) crossAttnRows.push(res.attn);
    }

    // logits layout: the decoderFn returns one row per input token.
    //  - full-sequence pass returns ALL rows [L, V] → take the last row
    //  - incremental pass returns a single row [V] (inputIds.length === 1)
    const seqLen = inputIds.length;
    const V = res.logits.length / seqLen;
    const last = res.logits.subarray((seqLen - 1) * V, seqLen * V);

    // no-speech probability: read the sot row from the full first-pass logits
    if (isFirst && sp.noSpeech >= 0 && tokens.length > sotIndex) {
      const off = sotIndex * V;
      let m = -Infinity;
      for (let v = 0; v < V; v++) {
        const x = res.logits[off + v];
        if (x > m) m = x;
      }
      let s = 0;
      for (let v = 0; v < V; v++) s += Math.exp(res.logits[off + v] - m);
      noSpeechProb = Math.exp(res.logits[off + sp.noSpeech] - m) / s;
    }

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
  // pack the accumulated per-token attention rows into [nGenerated, nFrames]
  let crossAttn: Float32Array | null = null;
  if (opts.needCrossAttn && crossAttnRows.length > 0) {
    crossAttn = new Float32Array(crossAttnRows.length * w);
    for (let i = 0; i < crossAttnRows.length; i++) {
      crossAttn.set(crossAttnRows[i], i * w);
    }
  }
  return {
    tokens: tokens.slice(sampleBegin),
    noSpeechProb,
    avgLogprob: generated > 0 ? sumLogprob / generated : sumLogprob,
    temperature,
    crossAttn,
  };
}
