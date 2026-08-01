/**
 * whisper/index.ts — entry point: load the Whisper ONNX model and run
 * transcribe + align against user lyrics.
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
import type { Lyrics } from '../../editor/lyrics';
import { logMelSpectrogram } from './mel';
import { WhisperTokenizer } from './tokenizer';
import { transcribe, type WhisperSegment } from './transcribe';
import { alignSegmentsToLyrics } from './align';

const SAMPLE_RATE = 16000;
const CHUNK_SAMPLES = 30 * SAMPLE_RATE; // 480000

export interface WhisperModel {
  encoderSession: any;
  decoderSession: any;
  tokenizer: WhisperTokenizer;
  languageToken: number;
  suppressTokens: number[];
  vocabSize: number;
}

export interface WhisperAlignOptions {
  noSpeechThreshold?: number;
  logprobThreshold?: number;
  globalOffsetMs?: number;
  /** language token id (e.g. sp.ja); defaults to the model's configured language */
  languageToken?: number;
  /** lyric furigana prompt tokens (encoded by the caller), injected every window */
  lyricsPromptTokens?: number[];
  onProgress?: (p: number) => void;
}

export interface WhisperAlignResult {
  segments: WhisperSegment[];
  lyrics: Lyrics;
}

function loadOnnx(): any {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const ort = eval('require')('onnxruntime-node');
  if (!ort) throw new Error('onnxruntime-node is not available');
  return ort;
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
  if (!fs.existsSync(encoderPath) || !fs.existsSync(decoderPath)) {
    throw new Error(`whisper model not found in ${modelDir}`);
  }
  const encoderSession = await ort.InferenceSession.create(encoderPath, {
    executionProviders: ['cpu'],
  });
  const decoderSession = await ort.InferenceSession.create(decoderPath, {
    executionProviders: ['cpu'],
  });

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

  // vocab size from decoder output
  const outMeta = decoderSession.outputMetadata[0];
  const dims = outMeta.shape as number[];
  const vocabSize = dims[dims.length - 1] ?? 51865;

  return {
    encoderSession,
    decoderSession,
    tokenizer,
    languageToken: sp.ja,
    suppressTokens,
    vocabSize,
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

  let currentHidden: any = null;
  const encoderFn = async (melSeg: Float32Array): Promise<unknown> => {
    const out = await encoderSession.run({
      input_features: new ort.Tensor('float32', melSeg, [1, 80, 3000]),
    });
    currentHidden = out[encoderSession.outputNames[0]];
    return currentHidden;
  };
  const decoderFn = async (inputIds: number[]): Promise<Float32Array> => {
    const out = await decoderSession.run({
      input_ids: new ort.Tensor(
        'int64',
        BigInt64Array.from(inputIds.map((x) => BigInt(x))),
        [1, inputIds.length],
      ),
      encoder_hidden_states: currentHidden,
    });
    return out[decoderSession.outputNames[0]].data as Float32Array;
  };

  return transcribe(encoderFn, decoderFn, mel, tokenizer, {
    languageToken: opts.languageToken ?? model.languageToken,
    suppressTokens: model.suppressTokens,
    lyricsPromptTokens: opts.lyricsPromptTokens,
    noSpeechThreshold: opts.noSpeechThreshold,
    logprobThreshold: opts.logprobThreshold,
    onProgress: opts.onProgress,
  });
}

/**
 * Run the full pipeline: audio (16k mono f32) -> mel -> transcribe -> align.
 * Returns the aligned lyrics (syllable times set) plus raw segments.
 */
export async function transcribeAndAlign(
  model: WhisperModel,
  audio: Float32Array,
  lyrics: Lyrics,
  opts: WhisperAlignOptions = {},
): Promise<WhisperAlignResult> {
  const segments = await transcribeAudio(model, audio, opts);
  alignSegmentsToLyrics(segments, lyrics, opts.globalOffsetMs ?? 0);
  return { segments, lyrics };
}
