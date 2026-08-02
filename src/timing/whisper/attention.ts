/**
 * whisper/attention.ts — cross-attention helpers for word-level timestamps.
 *
 * Averaging every head washes out the alignment signal, so we only average the
 * official alignment heads (openai/whisper _ALIGNMENT_HEADS, decoded from the
 * base85+gzip payload shipped in the python package):
 *   - multilingual `base`  (6 layers × 8 heads):  [(3,1),(4,2),(4,3),(4,7),(5,1),(5,2),(5,4),(5,6)]
 *   - multilingual `medium`(24 layers × 16 heads):[(13,15),(15,4),(15,15),(16,1),(20,0),(23,4)]
 * The table is selected by the decoder shape observed on the tensors, so the
 * same code works for both model sizes.
 *
 * Also hosts the shared katakana→hiragana normalizer used by both the
 * word-timestamp DTW and the lyric alignment matcher.
 */

/** Official alignment heads per model size, keyed by `layers x heads`. */
const ALIGNMENT_HEADS: Record<
  string,
  ReadonlyArray<readonly [number, number]>
> = {
  '6x8': [
    [3, 1],
    [4, 2],
    [4, 3],
    [4, 7],
    [5, 1],
    [5, 2],
    [5, 4],
    [5, 6],
  ],
  '24x16': [
    [13, 15],
    [15, 4],
    [15, 15],
    [16, 1],
    [20, 0],
    [23, 4],
  ],
};

/** Fallback when the model size is unknown: last half of layers, all heads. */
function fallbackHeads(layers: number, heads: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let l = Math.floor(layers / 2); l < layers; l++) {
    for (let h = 0; h < heads; h++) out.push([l, h]);
  }
  return out;
}

/** Pick the official alignment-head table for the observed decoder shape. */
function alignmentHeadsFor(
  layers: number,
  heads: number,
): ReadonlyArray<readonly [number, number]> {
  return ALIGNMENT_HEADS[`${layers}x${heads}`] ?? fallbackHeads(layers, heads);
}

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
  const nHeads = first.dims ? (first.dims[1] ?? 16) : 16;
  const Tenc = first.dims ? (first.dims[3] ?? 3000) : 3000;
  const nLayers = crossAttnNames.length;
  const table = alignmentHeadsFor(nLayers, nHeads);
  const attnAll = new Float32Array(inputLen * Tenc);
  let nAvg = 0;
  for (const [layer, head] of table) {
    const name = crossAttnNames.find(
      (n) => parseInt(n.split('.')[1], 10) === layer,
    );
    if (!name || head >= nHeads) continue;
    const data = out[name].data as Float32Array;
    const headStride = inputLen * Tenc;
    const hOff = head * headStride;
    for (let row = 0; row < inputLen; row++) {
      const off = hOff + row * Tenc;
      for (let j = 0; j < Tenc; j++) {
        attnAll[row * Tenc + j] += data[off + j];
      }
    }
    nAvg += 1;
  }
  if (nAvg > 0) {
    for (let i = 0; i < attnAll.length; i++) attnAll[i] /= nAvg;
  }
  return attnAll;
}

/**
 * Average the cross-attention of the LAST decoder token row over the official
 * alignment heads. Used by the incremental decoder (each step yields one new
 * token, so we only need that token's row). Returns [Tenc].
 */
export function lastTokenAttention(
  out: Record<string, { data: ArrayLike<number>; dims?: number[] }>,
  crossAttnNames: string[],
): Float32Array | null {
  if (crossAttnNames.length === 0) return null;
  const first = out[crossAttnNames[0]];
  const nHeads = first.dims ? (first.dims[1] ?? 16) : 16;
  const Tdec = first.dims ? (first.dims[2] ?? 1) : 1;
  const Tenc = first.dims ? (first.dims[3] ?? 3000) : 3000;
  const nLayers = crossAttnNames.length;
  const table = alignmentHeadsFor(nLayers, nHeads);
  const row = Tdec - 1;
  const attn = new Float32Array(Tenc);
  let nAvg = 0;
  for (const [layer, head] of table) {
    const name = crossAttnNames.find(
      (n) => parseInt(n.split('.')[1], 10) === layer,
    );
    if (!name || head >= nHeads) continue;
    const data = out[name].data as Float32Array;
    const headStride = Tdec * Tenc;
    const off = head * headStride + row * Tenc;
    for (let j = 0; j < Tenc; j++) attn[j] += data[off + j];
    nAvg += 1;
  }
  if (nAvg > 0) {
    for (let j = 0; j < Tenc; j++) attn[j] /= nAvg;
  }
  return attn;
}

/** Katakana → Hiragana (1:1 Unicode shift) for matching/alignment. */
export function toHiragana(ch: string): string {
  const c = ch.charCodeAt(0);
  if (c >= 0x30a1 && c <= 0x30f6) return String.fromCharCode(c - 0x60);
  return ch;
}
