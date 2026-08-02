/**
 * whisper/wordtimestamps.ts — word-level timestamps from cross-attention.
 *
 * Port of whisper's find_alignment: DTW-align the text tokens onto the encoder
 * frame axis using cross-attention, then map frames to seconds with the window
 * offset and group tokens into words. Timestamp tokens pin the segment edges.
 */
import type { WhisperSegment } from './transcribe';

// seconds per encoder frame. The encoder downsamples 3000 mel frames (30s) to
// 1500 tokens, so each encoder frame spans 2 mel frames = 0.02s.
const FRAME_DURATION = 0.02;
const INF = 1e30;

/**
 * Dynamic time warping: align `nText` tokens monotonically onto `nFrames`
 * encoder frames, minimising the total -log(attention) along the path.
 * Returns one frame index per token (non-decreasing).
 */
function dtwFrames(
  attn: Float32Array, // [nText, nFrames]
  nText: number,
  nFrames: number,
): number[] {
  const W = nFrames + 1;
  const cost = new Float64Array((nText + 1) * W);
  for (let j = 1; j <= nFrames; j++) cost[j] = INF; // first row
  for (let i = 1; i <= nText; i++) cost[i * W] = INF; // first column
  cost[0] = 0;

  for (let i = 1; i <= nText; i++) {
    const attnRow = (i - 1) * nFrames;
    for (let j = 1; j <= nFrames; j++) {
      const up = cost[(i - 1) * W + j];
      const left = cost[i * W + (j - 1)];
      const diag = cost[(i - 1) * W + (j - 1)];
      const a = -attn[attnRow + (j - 1)];
      cost[i * W + j] = Math.min(up, left, diag) + a;
    }
  }

  // backtrack (each token i gets the frame where its path step lands)
  const frames: number[] = new Array(nText);
  let i = nText;
  let j = nFrames;
  while (i > 0 && j > 0) {
    const up = cost[(i - 1) * W + j];
    const left = cost[i * W + (j - 1)];
    const diag = cost[(i - 1) * W + (j - 1)];
    if (diag <= up && diag <= left) {
      frames[i - 1] = j - 1;
      i -= 1;
      j -= 1;
    } else if (up <= left) {
      frames[i - 1] = j - 1;
      i -= 1;
    } else {
      j -= 1;
    }
  }
  return frames;
}

export interface WordTime {
  start: number;
  end: number;
  text: string;
}

/**
 * Compute word times for a segment using its cross-attention.
 * @param seg segment with crossAttn [nTokens, nFrames]
 * @param windowOffset seconds added to window-relative frame times
 * @param tsBegin timestamp token id (tokens >= tsBegin are timestamps)
 * @param decode decode a token slice to text
 */
export function segmentWordTimes(
  seg: WhisperSegment,
  windowOffset: number,
  tsBegin: number,
  decode: (tokens: number[]) => string,
): WordTime[] | null {
  if (!seg.crossAttn || seg.crossAttn.length === 0) return null;
  const tokens = seg.tokens;
  const nTokens = tokens.length;
  if (nTokens === 0) return null;
  const nFrames = seg.crossAttn.length / nTokens;
  if (nFrames <= 0) return null;

  // 1) collect text-token rows (timestamps excluded) into a compact matrix,
  // restricted to the segment's own frame span so leading/trailing silence in
  // the 30s window doesn't shift the alignment.
  const textIdx: number[] = [];
  for (let i = 0; i < nTokens; i++) if (tokens[i] < tsBegin) textIdx.push(i);
  const nText = textIdx.length;
  if (nText === 0) return null;
  const startFrame = Math.max(
    0,
    Math.round((seg.start - windowOffset) / FRAME_DURATION),
  );
  const endFrame = Math.min(
    nFrames - 1,
    Math.round((seg.end - windowOffset) / FRAME_DURATION),
  );
  const nSegFrames = Math.max(1, endFrame - startFrame + 1);
  const attnText = new Float32Array(nText * nSegFrames);
  for (let k = 0; k < nText; k++) {
    attnText.set(
      seg.crossAttn.subarray(
        textIdx[k] * nFrames + startFrame,
        textIdx[k] * nFrames + endFrame + 1,
      ),
      k * nSegFrames,
    );
  }

  // 2) DTW: monotonic (segment-relative) frame per text token
  const dtwF = dtwFrames(attnText, nText, nSegFrames);
  const times: number[] = new Array(nTokens);
  for (let k = 0; k < nText; k++) {
    times[textIdx[k]] = (startFrame + dtwF[k]) * FRAME_DURATION;
  }

  // 3) pin timestamp tokens to the segment edges
  const firstTs = tokens.findIndex((t) => t >= tsBegin);
  let lastTs = -1;
  for (let i = 0; i < nTokens; i++) if (tokens[i] >= tsBegin) lastTs = i;
  for (let i = 0; i < nTokens; i++) {
    if (tokens[i] >= tsBegin) {
      times[i] = i === firstTs ? seg.start : i === lastTs ? seg.end : times[i];
    }
  }

  // 4) group text tokens into words, absolute time = windowOffset + frame time.
  // CJK text has no real word boundaries (whisper's BPE may still emit `Ġ`
  // space tokens, so we detect CJK by characters, not whitespace). For CJK we
  // emit one word per text token (~1-2 chars each), preserving the DTW-derived
  // per-token timing for syllable anchoring; for space-delimited languages we
  // group by whitespace as usual.
  const words: WordTime[] = [];
  const decoded = decode(tokens.filter((t) => t < tsBegin)).trim();
  const cjk = /[\u3040-\u30ff\u4e00-\u9fff\u3400-\u4dbf]/.test(decoded);
  let curStart = -1;
  let curTokens: number[] = [];
  const flush = () => {
    if (curTokens.length === 0) return;
    const start = windowOffset + times[curStart];
    const end = windowOffset + times[curStart + curTokens.length - 1];
    const text = decode(curTokens).trim();
    if (text.length > 0) words.push({ start, end, text });
    curTokens = [];
  };
  for (let i = 0; i < nTokens; i++) {
    if (tokens[i] >= tsBegin) {
      flush();
      curStart = -1;
      continue;
    }
    if (cjk) {
      // one token = one word (token-level granularity)
      const text = decode([tokens[i]]).trim();
      if (text.length > 0) {
        words.push({
          start: windowOffset + times[i],
          end: windowOffset + times[i],
          text,
        });
      }
      continue;
    }
    if (curStart < 0) curStart = i;
    curTokens.push(tokens[i]);
  }
  if (!cjk) flush();

  return words.length > 0 ? words : null;
}
