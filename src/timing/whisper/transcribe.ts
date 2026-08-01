/**
 * whisper/transcribe.ts — whole-track 30s sliding-window transcription with
 * timestamps, reproducing whisper/transcribe.py's main loop.
 *
 * The caller provides:
 *   - encoderFn(melSeg): run the encoder onnx on one [80,3000] mel window -> hidden states
 *   - decoderFn(inputIds): run the decoder onnx -> full logits [L, V]
 */
import { decodeWindow } from './decode';
import type { WhisperTokenizer } from './tokenizer';

const SAMPLE_RATE = 16000;
const HOP_LENGTH = 160;
const N_FRAMES = 3000; // 30s of mel frames
const N_MELS = 80;
const TIME_PRECISION = 0.02;
const FRAME_DURATION = HOP_LENGTH / SAMPLE_RATE; // 0.01s per mel frame
const INPUT_STRIDE = N_FRAMES / 1500; // 2 mel frames per output token

export interface WhisperSegment {
  start: number;
  end: number;
  text: string;
  tokens: number[];
}

export interface TranscribeOptions {
  languageToken: number;
  suppressTokens: number[];
  /** lyric furigana prompt tokens, injected every window */
  lyricsPromptTokens?: number[];
  noSpeechThreshold?: number; // default 0.6
  logprobThreshold?: number; // default -1.0
  onProgress?: (p: number) => void;
}

/**
 * @param mel full log-mel [N_MELS, totalFrames] (already padded by 30s on the right)
 * @param totalFrames mel frame count = mel.length / N_MELS
 */
export async function transcribe(
  encoderFn: (melSeg: Float32Array) => Promise<unknown>,
  decoderFn: (inputIds: number[]) => Promise<Float32Array>,
  mel: Float32Array,
  tokenizer: WhisperTokenizer,
  opts: TranscribeOptions,
): Promise<WhisperSegment[]> {
  const tsBegin = tokenizer.specials.timestampBegin;
  const totalFrames = mel.length / N_MELS;
  const contentFrames = totalFrames - N_FRAMES; // frames after the 30s padding
  const noSpeechThreshold = opts.noSpeechThreshold ?? 0.6;
  const logprobThreshold = opts.logprobThreshold ?? -1.0;

  const allSegments: WhisperSegment[] = [];
  let allTokens: number[] = [];
  let seek = 0;
  let windowCount = 0;
  // safety valve: each window must advance seek; assume >= 100 frames (1s) per window
  const maxWindows = Math.ceil(contentFrames / 100) + 64;

  // advance `seek` monotonically (guard against a window that ends on a 0.00 timestamp)
  const advance = (next: number): void => {
    seek = next > seek ? next : seek + 1;
  };

  const decodeText = (tokens: number[]): string => tokenizer.decode(tokens);

  while (seek < contentFrames) {
    const segFrames = Math.min(N_FRAMES, contentFrames - seek);
    // build one [80, 3000] window (right-pad with zeros)
    const melSeg = new Float32Array(N_MELS * N_FRAMES);
    for (let m = 0; m < N_MELS; m++) {
      const src = mel.subarray(
        m * totalFrames + seek,
        m * totalFrames + seek + segFrames,
      );
      melSeg.set(src, m * N_FRAMES);
    }
    const timeOffset = seek * FRAME_DURATION;

    // encode this window (caller stores hidden states for decoderFn)
    await encoderFn(melSeg);

    const result = await decodeWindow(decoderFn, tokenizer, {
      task: 'transcribe',
      languageToken: opts.languageToken,
      suppressTokens: opts.suppressTokens,
      promptTokens: allTokens,
    });
    const tokens = result.tokens;

    // no-speech skip
    let shouldSkip = result.noSpeechProb > noSpeechThreshold;
    if (result.avgLogprob > logprobThreshold) shouldSkip = false;
    if (shouldSkip) {
      advance(seek + segFrames);
      opts.onProgress?.(contentFrames > 0 ? seek / contentFrames : 1);
      windowCount += 1;
      if (windowCount > maxWindows) break;
      continue;
    }

    const prevSeek = seek;
    const currentSegments: WhisperSegment[] = [];

    const tsMask = tokens.map((t) => t >= tsBegin);
    const singleTsEnding =
      tsMask.length >= 2 &&
      !tsMask[tsMask.length - 2] &&
      tsMask[tsMask.length - 1];
    const consecutive: number[] = [];
    for (let i = 0; i < tsMask.length - 1; i++) {
      if (tsMask[i] && tsMask[i + 1]) consecutive.push(i + 1);
    }

    if (consecutive.length > 0) {
      const slices = consecutive.slice();
      if (singleTsEnding) slices.push(tokens.length);
      let last = 0;
      for (const s of slices) {
        const sliced = tokens.slice(last, s);
        const startPos = sliced[0] - tsBegin;
        const endPos = sliced[sliced.length - 1] - tsBegin;
        currentSegments.push({
          start: timeOffset + startPos * TIME_PRECISION,
          end: timeOffset + endPos * TIME_PRECISION,
          text: decodeText(sliced),
          tokens: sliced,
        });
        last = s;
      }
      if (singleTsEnding) {
        advance(seek + segFrames);
      } else {
        const lastTsPos = tokens[last - 1] - tsBegin;
        advance(seek + lastTsPos * INPUT_STRIDE);
      }
    } else {
      let duration = segFrames * FRAME_DURATION;
      const timestamps = tokens.filter((t) => t >= tsBegin);
      if (
        timestamps.length > 0 &&
        timestamps[timestamps.length - 1] !== tsBegin
      ) {
        const lastTsPos = timestamps[timestamps.length - 1] - tsBegin;
        duration = lastTsPos * TIME_PRECISION;
      }
      currentSegments.push({
        start: timeOffset,
        end: timeOffset + duration,
        text: decodeText(tokens),
        tokens,
      });
      advance(seek + segFrames);
    }

    // clear instantaneous / empty segments, then accumulate
    const kept = currentSegments.filter(
      (s) => s.end > s.start && s.text.trim().length > 0,
    );
    for (const s of kept) allTokens.push(...s.tokens);
    allSegments.push(...kept);

    opts.onProgress?.(
      contentFrames > 0 ? Math.min(seek, contentFrames) / contentFrames : 1,
    );
    windowCount += 1;
    if (windowCount > maxWindows) break;
    void prevSeek;
  }

  return allSegments;
}
