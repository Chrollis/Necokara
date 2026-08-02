/**
 * whisper/index.ts — entry point: load the Whisper ONNX model and transcribe.
 *
 * Model layout (models/whisper/):
 *   onnx/encoder_model.onnx, onnx/decoder_model.onnx,
 *   vocab.json, tokenizer.json, added_tokens.json, ...
 *
 * onnxruntime-node is loaded via eval('require') to keep webpack happy
 * (it cannot statically resolve the native .node addon).
 */
import * as path from 'path';
import * as fs from 'fs';
import { logMelSpectrogram } from './mel';
import { WhisperTokenizer } from './tokenizer';
import { transcribe, type WhisperSegment } from './transcribe';
import { lastTokenAttention } from './attention';
import { createSession, loadOnnx } from '../onnx';

const SAMPLE_RATE = 16000;
const CHUNK_SAMPLES = 30 * SAMPLE_RATE; // 480000

/** Minimal onnxruntime InferenceSession surface used by the worker. */
export interface OnnxSession {
  run(inputs: Record<string, unknown>): Promise<Record<string, unknown>>;
  inputNames: readonly string[];
  outputNames: readonly string[];
}

/** KV-cache state for one decoder pass (present.* outputs). */
export interface KVTensor {
  data: Float32Array;
  dims: number[];
}
export interface KVState {
  [name: string]: KVTensor;
}

export interface WhisperModel {
  encoderSession: OnnxSession;
  decoderSession: OnnxSession;
  /** KV-cache incremental decoder (decoder_with_past_model.onnx), always present */
  decoderPastSession: OnnxSession;
  tokenizer: WhisperTokenizer;
  languageToken: number;
  suppressTokens: number[];
}

export interface WhisperAlignOptions {
  noSpeechThreshold?: number;
  logprobThreshold?: number;
  /** language token id (e.g. sp.ja); defaults to the model's configured language */
  languageToken?: number;
  onProgress?: (p: number) => void;
}

/**
 * Load the Whisper ONNX encoder/decoder + tokenizer from a model directory.
 * @param modelDir e.g. "models/whisper"
 */
export async function loadWhisperModel(
  modelDir: string,
): Promise<WhisperModel> {
  const ort = loadOnnx();
  const onnxDir = path.join(modelDir, 'onnx');
  const encoderPath = path.join(onnxDir, 'encoder_model.onnx');
  const decoderPath = path.join(onnxDir, 'decoder_model.onnx');
  const decoderPastPath = path.join(onnxDir, 'decoder_with_past_model.onnx');
  if (
    !fs.existsSync(encoderPath) ||
    !fs.existsSync(decoderPath) ||
    !fs.existsSync(decoderPastPath)
  ) {
    throw new Error(
      `whisper model not found in ${modelDir} (need encoder/decoder/decoder_with_past onnx)`,
    );
  }
  const encoderSession = await createSession(encoderPath);
  const decoderSession = await createSession(decoderPath);
  const decoderPastSession = await createSession(decoderPastPath);

  const vocabJson = JSON.parse(
    fs.readFileSync(path.join(modelDir, 'vocab.json'), 'utf-8'),
  );
  const tokenizerJson = JSON.parse(
    fs.readFileSync(path.join(modelDir, 'tokenizer.json'), 'utf-8'),
  );
  const tokenizer = new WhisperTokenizer(vocabJson, tokenizerJson);

  const sp = tokenizer.specials;
  const suppressTokens = Array.from(
    new Set([
      ...tokenizer.nonSpeechTokens(),
      sp.transcribe,
      sp.translate,
      sp.sot,
      sp.sotPrev,
      sp.sotLm,
      sp.noSpeech,
    ]),
  );

  return {
    encoderSession,
    decoderSession,
    decoderPastSession,
    tokenizer,
    languageToken: sp.ja,
    suppressTokens,
  };
}

/**
 * Transcribe 16k mono audio to timestamped segments (no alignment).
 * Used by the whisper worker; alignment happens on the renderer side.
 */
export async function transcribeAudio(
  model: WhisperModel,
  audio: Float32Array,
  opts: WhisperAlignOptions = {},
): Promise<WhisperSegment[]> {
  const ort = loadOnnx();
  const { encoderSession, decoderSession, tokenizer } = model;

  // full mel with 30s trailing silence (whisper padding)
  const mel = logMelSpectrogram(audio, 80, CHUNK_SAMPLES);

  let currentHidden: unknown = null;
  const encoderFn = async (melSeg: Float32Array): Promise<unknown> => {
    const out = await encoderSession.run({
      input_features: new ort.Tensor('float32', melSeg, [1, 80, 3000]),
    });
    currentHidden = out[encoderSession.outputNames[0]];
    return currentHidden;
  };
  /**
   * Incremental decoder:
   *  - `inputIds.length > 1` → full-sequence pass (no KV), returns initial KV
   *  - `inputIds.length === 1` → single-token incremental pass with `kv`
   * Returns the logits row predicting the NEXT token + updated KV + the new
   * token's cross-attention row [Tenc].
   */
  const decoderFn = async (
    inputIds: number[],
    kv?: KVState | null,
  ): Promise<{
    logits: Float32Array;
    kv: KVState;
    attn: Float32Array | null;
  }> => {
    const isIncremental = inputIds.length === 1 && kv != null;
    const session = isIncremental ? model.decoderPastSession : decoderSession;
    const feeds: Record<string, unknown> = {
      input_ids: new ort.Tensor(
        'int64',
        BigInt64Array.from(inputIds.map((x) => BigInt(x))),
        [1, inputIds.length],
      ),
      encoder_hidden_states: currentHidden,
    };
    if (isIncremental) {
      // feed past_key_values.* from the cached present.* KV
      for (const name of session.inputNames) {
        const src = kv[name.replace('past_key_values.', 'present.')];
        if (name.startsWith('past_key_values.') && src) {
          feeds[name] = new ort.Tensor('float32', src.data, src.dims);
        }
      }
    }
    const out = await session.run(feeds);
    const logitsName =
      session.outputNames.find((n) => n === 'logits') ?? session.outputNames[0];
    const full = out[logitsName] as { data: Float32Array; dims?: number[] };
    // Full-sequence pass returns ALL logits rows [L, V] so the caller can read
    // the sot row (no-speech) and the last row (next-token prediction).
    // Incremental pass returns a single row [V].
    const logits = full.data;

    // KV cache: collect present.* outputs for the next incremental step.
    // NOTE: the with_past decoder only re-emits the DECODER key/value cache
    // (48 tensors); the ENCODER cache is unchanged across steps (the encoder
    // hidden states are fixed for the whole window), so we must carry the
    // previous encoder KV forward — otherwise the next incremental step is
    // missing its past_key_values.N.encoder.* inputs.
    const kvOut: KVState = {};
    if (isIncremental && kv) {
      for (const [name, t] of Object.entries(kv)) {
        if (name.startsWith('present.') && name.includes('.encoder.')) {
          kvOut[name] = t;
        }
      }
    }
    for (const n of session.outputNames) {
      if (n.startsWith('present.')) {
        const t = out[n] as { data: Float32Array; dims?: number[] };
        kvOut[n] = { data: t.data, dims: (t.dims ?? []).slice() };
      }
    }

    // cross-attention for the newly predicted token row (word timestamps)
    const crossAttnNames: string[] = session.outputNames.filter((n) =>
      n.startsWith('cross_attentions.'),
    );
    const attn = lastTokenAttention(
      out as Record<string, { data: ArrayLike<number>; dims?: number[] }>,
      crossAttnNames,
    );
    return { logits, kv: kvOut, attn };
  };

  return transcribe(encoderFn, decoderFn, mel, tokenizer, {
    languageToken: opts.languageToken ?? model.languageToken,
    suppressTokens: model.suppressTokens,
    noSpeechThreshold: opts.noSpeechThreshold,
    logprobThreshold: opts.logprobThreshold,
    incremental: true,
    onProgress: opts.onProgress,
  });
}
