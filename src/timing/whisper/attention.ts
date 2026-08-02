/**
 * whisper/attention.ts — cross-attention helpers for word-level timestamps.
 *
 * The medium_timestamped decoder exposes per-layer `cross_attentions.N`
 * outputs. Averaging every head washes out the alignment signal, so we only
 * average the official alignment heads (whisper/attention.py _ALIGNMENT_HEADS):
 * multilingual `medium` uses heads 14 & 15 per layer (layers 0/1 head 15 only).
 *
 * Also hosts the shared katakana→hiragana normalizer used by both the
 * word-timestamp DTW and the lyric alignment matcher.
 */

/** Official alignment heads for the multilingual `medium` model. */
const MEDIUM_ALIGNMENT_HEADS: ReadonlyArray<readonly [number, number]> =
  (() => {
    const heads: Array<[number, number]> = [];
    for (let layer = 0; layer < 24; layer++) {
      if (layer >= 2) heads.push([layer, 14]);
      heads.push([layer, 15]);
    }
    return heads;
  })();

/**
 * Average the per-layer cross-attention tensors over the official alignment
 * heads. Each `out[name]` is [1, nHeads, T_dec, T_enc]; the result is packed
 * row-major [T_dec, T_enc] (row i = token i's attention to encoder frames).
 * @param out decoder session outputs keyed by output name
 * @param crossAttnNames output names starting with `cross_attentions.`
 * @param inputLen T_dec (number of decoder input tokens)
 */
export function averageCrossAttention(
  out: Record<string, { data: ArrayLike<number>; dims?: number[] }>,
  crossAttnNames: string[],
  inputLen: number,
): Float32Array | null {
  if (crossAttnNames.length === 0) return null;
  const first = out[crossAttnNames[0]];
  const heads = first.dims ? (first.dims[1] ?? 16) : 16;
  const Tenc = first.dims ? (first.dims[3] ?? 3000) : 3000;
  const attnAll = new Float32Array(inputLen * Tenc);
  let nAvg = 0;
  // cross_attentions.N may come back in arbitrary order; process by layer
  const layerNames = crossAttnNames.slice().sort((a, b) => {
    const na = parseInt(a.split('.')[1], 10);
    const nb = parseInt(b.split('.')[1], 10);
    return na - nb;
  });
  for (const name of layerNames) {
    const data = out[name].data as Float32Array;
    const headStride = inputLen * Tenc;
    for (const [, h] of MEDIUM_ALIGNMENT_HEADS) {
      if (h >= heads) continue;
      const hOff = h * headStride;
      for (let row = 0; row < inputLen; row++) {
        const off = hOff + row * Tenc;
        for (let j = 0; j < Tenc; j++) {
          attnAll[row * Tenc + j] += data[off + j];
        }
      }
      nAvg += 1;
    }
  }
  if (nAvg > 0) {
    for (let i = 0; i < attnAll.length; i++) attnAll[i] /= nAvg;
  }
  return attnAll;
}

/** Katakana → Hiragana (1:1 Unicode shift) for matching/alignment. */
export function toHiragana(ch: string): string {
  const c = ch.charCodeAt(0);
  if (c >= 0x30a1 && c <= 0x30f6) return String.fromCharCode(c - 0x60);
  return ch;
}
