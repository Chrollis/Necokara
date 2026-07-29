/**
 * separate-worker.ts — Worker thread for vocal separation + onset detection.
 *
 * Uses pleco-xa REPET-SIM (nn_filter) for separation and onset_strength
 * for onset detection. Pure JS, no native deps or model files.
 */

import { parentPort } from 'worker_threads';

parentPort?.on(
  'message',
  async (msg: { audioData: Float32Array; sampleRate: number }) => {
    const oldPriority = (process as any).priority;
    try {
      (process as any).priority = 6;

      const { audioData, sampleRate } = msg;
      const TARGET_SR = 22050;
      const mono = resample(audioData, sampleRate, TARGET_SR);
      if (mono.length < TARGET_SR) {
        parentPort?.postMessage({ error: 'Audio too short' });
        return;
      }

      const pleco = await import('pleco-xa');
      const nFft = 2048;
      const hopLength = 2048;

      // ── STFT ──
      const stftMat = pleco.stft(mono, nFft, hopLength) as {
        real: number;
        imag: number;
      }[][];
      const nFreq = stftMat.length;
      const nFrames = stftMat[0].length;

      // Magnitude spectrogram
      const mag: number[][] = [];
      for (let f = 0; f < nFreq; f++) {
        const row: number[] = [];
        for (let t = 0; t < nFrames; t++) {
          const { real, imag } = stftMat[f][t];
          row.push(Math.sqrt(real * real + imag * imag));
        }
        mag.push(row);
      }

      // ── REPET-SIM: nn_filter → background ──
      const bgMag = pleco.decompose.nn_filter(mag, {
        aggregate: 'median',
        metric: 'cosine',
        width: 3,
        k: Math.max(2, Math.floor(nFrames * 0.05)),
      } as any) as unknown as number[][];

      // ── Soft mask ──
      const mask = pleco.decompose.softmask(mag, bgMag, {
        power: 2,
      }) as unknown as number[][];

      // ── Apply mask → ISTFT ──
      const vocalStft: { real: number; imag: number }[][] = [];
      for (let f = 0; f < nFreq; f++) {
        const row: { real: number; imag: number }[] = [];
        for (let t = 0; t < nFrames; t++) {
          const { real, imag } = stftMat[f][t];
          const m = mask[f][t];
          row.push({ real: real * m, imag: imag * m });
        }
        vocalStft.push(row);
      }
      const vocals = pleco.istft(vocalStft, hopLength) as Float32Array;

      // ── Accompaniment ──
      const accStft: { real: number; imag: number }[][] = [];
      for (let f = 0; f < nFreq; f++) {
        const row: { real: number; imag: number }[] = [];
        for (let t = 0; t < nFrames; t++) {
          const { real, imag } = stftMat[f][t];
          row.push({
            real: real * (1 - mask[f][t]),
            imag: imag * (1 - mask[f][t]),
          });
        }
        accStft.push(row);
      }
      const accompaniment = pleco.istft(accStft, hopLength) as Float32Array;

      // ── Onset detection on vocals ──
      const strength = pleco.onset_strength(vocals, {
        sr: TARGET_SR,
        hop_length: hopLength,
        n_mels: 128,
      });
      const peakFrames = pleco.peakPick(Array.from(strength), {
        preMax: 2,
        postMax: 2,
        preAvg: 6,
        postAvg: 6,
        delta: 1.5,
        wait: 12,
        sparse: true,
      });
      const onsets = peakFrames.map(
        (f: number) => f * (hopLength / TARGET_SR) * 1000,
      );

      // ── Return result ──
      parentPort?.postMessage({
        vocals: Array.from(vocals),
        accompaniment: Array.from(accompaniment),
        onsets,
      });
    } catch (err) {
      parentPort?.postMessage({ error: String(err) });
    } finally {
      (process as any).priority = oldPriority;
    }
  },
);

function resample(
  data: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate) return data;
  const ratio = toRate / fromRate;
  const newLen = Math.round(data.length * ratio);
  const out = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const srcIdx = i / ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, data.length - 1);
    const frac = srcIdx - lo;
    out[i] = data[lo] + (data[hi] - data[lo]) * frac;
  }
  return out;
}
