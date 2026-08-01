/**
 * whisper/mel.ts — log-Mel spectrogram preprocessing for Whisper.
 *
 * Reproduces whisper/audio.py log_mel_spectrogram exactly:
 *   - 16 kHz mono input
 *   - periodic Hann(400) window, STFT n_fft=400 / hop=160, center=true, reflect pad
 *   - drop the last frame (so 30 s -> exactly 3000 frames)
 *   - mel filterbank: librosa.filters.mel(sr=16000, n_fft=400, n_mels=80) (slaney norm)
 *   - log10(clamp(min=1e-10)), then (x - max + 8) -> (x + 4) / 4
 *
 * STFT comes from ../fft (zaft-backed, arbitrary length) so this is pure JS and
 * cross-platform — no python/librosa at runtime.
 */
import { stft, hannWindow } from '../fft';
import type { ComplexBin } from '../fft';

// librosa hz_to_mel (slaney, htk=false)
function hzToMel(freqs: number[]): number[] {
  const fSp = 200.0 / 3;
  const minLogHz = 1000.0;
  const minLogMel = (minLogHz - 0.0) / fSp;
  const logstep = Math.log(6.4) / 27.0;
  return freqs.map((f) => {
    if (f <= minLogHz) return (f - 0.0) / fSp;
    return minLogMel + Math.log(f / minLogHz) / logstep;
  });
}

// librosa mel_to_hz (slaney, htk=false)
function melToHz(mels: number[]): number[] {
  const fSp = 200.0 / 3;
  const minLogHz = 1000.0;
  const minLogMel = (minLogHz - 0.0) / fSp;
  const logstep = Math.log(6.4) / 27.0;
  return mels.map((m) => {
    if (m <= minLogMel) return 0.0 + fSp * m;
    return minLogHz * Math.exp(logstep * (m - minLogMel));
  });
}

function melFrequencies(nMels: number, fMin: number, fMax: number): number[] {
  const minMel = hzToMel([fMin])[0];
  const maxMel = hzToMel([fMax])[0];
  const mels: number[] = [];
  for (let i = 0; i < nMels; i++) {
    mels.push(minMel + ((maxMel - minMel) * i) / (nMels - 1));
  }
  return melToHz(mels);
}

export interface MelFilterbank {
  weights: Float64Array[]; // [nMels][nFft/2+1]
  nMels: number;
  nFft: number;
}

/**
 * Build a librosa-style mel filterbank (slaney norm).
 * @returns weights[nMels][nFreq], nFreq = nFft/2 + 1
 */
export function melFilterbank(
  sr: number,
  nFft: number,
  nMels: number,
  fMin = 0,
  fMax = sr / 2,
): MelFilterbank {
  const nFreq = Math.floor(nFft / 2) + 1;
  const fftfreqs: number[] = [];
  for (let i = 0; i < nFreq; i++) fftfreqs.push((i * sr) / nFft);
  const melF = melFrequencies(nMels + 2, fMin, fMax);
  const fdiff: number[] = [];
  for (let i = 0; i < melF.length - 1; i++) fdiff.push(melF[i + 1] - melF[i]);

  const weights: Float64Array[] = [];
  for (let i = 0; i < nMels; i++) {
    const w = new Float64Array(nFreq);
    for (let j = 0; j < nFreq; j++) {
      // librosa: lower = -ramps[i]/fdiff[i], upper = ramps[i+2]/fdiff[i+1]
      // where ramps[i][j] = mel_f[i] - fftfreqs[j]
      const lower = (fftfreqs[j] - melF[i]) / fdiff[i];
      const upper = (melF[i + 2] - fftfreqs[j]) / fdiff[i + 1];
      let v = Math.min(lower, upper);
      if (v < 0) v = 0;
      w[j] = v;
    }
    // slaney norm: 2 / (right - left) per filter
    const enorm = 2.0 / (melF[i + 2] - melF[i]);
    for (let j = 0; j < nFreq; j++) w[j] *= enorm;
    weights.push(w);
  }
  return { weights, nMels, nFft };
}

let cachedFilterbank: MelFilterbank | null = null;

function getMel80(): MelFilterbank {
  if (!cachedFilterbank) {
    cachedFilterbank = melFilterbank(16000, 400, 80, 0, 8000);
  }
  return cachedFilterbank;
}

/**
 * Compute log-Mel spectrogram of 16k mono audio.
 * @returns Float32Array of length nMels * frames (row-major: [mel][frame])
 */
export function logMelSpectrogram(
  audio: Float32Array,
  nMels = 80,
  padding = 0,
): Float32Array {
  const nFft = 400;
  const hop = 160;
  // right-pad zeros (whisper F.pad(audio, (0, padding)))
  let y = audio;
  if (padding > 0) {
    y = new Float32Array(audio.length + padding);
    y.set(audio);
  }

  const win = hannWindow(nFft); // periodic hann
  const S: ComplexBin[][] = stft(y, nFft, hop, win);
  const nFrames = S[0].length;
  const nFreq = S.length; // 201
  // magnitudes = |stft|^2 with the LAST frame dropped -> [nFreq, frames]
  const frames = nFrames - 1;
  const magnitudes: Float64Array[] = [];
  for (let f = 0; f < nFreq; f++) {
    const mag = new Float64Array(frames);
    for (let t = 0; t < frames; t++) {
      const c = S[f][t];
      mag[t] = c.real * c.real + c.imag * c.imag;
    }
    magnitudes.push(mag);
  }

  const fb =
    nMels === 80 ? getMel80() : melFilterbank(16000, nFft, nMels, 0, 8000);
  // mel_spec = filters @ magnitudes -> [nMels, frames]
  const out = new Float32Array(nMels * frames);
  for (let m = 0; m < nMels; m++) {
    const row = fb.weights[m];
    for (let t = 0; t < frames; t++) {
      let acc = 0;
      for (let f = 0; f < nFreq; f++) {
        acc += row[f] * magnitudes[f][t];
      }
      out[m * frames + t] = acc;
    }
  }

  // log10(clamp(1e-10)) then (x - max + 8), then (x + 4)/4
  let maxVal = -Infinity;
  for (let i = 0; i < out.length; i++) {
    let v = out[i];
    if (v < 1e-10) v = 1e-10;
    out[i] = Math.log10(v);
    if (out[i] > maxVal) maxVal = out[i];
  }
  for (let i = 0; i < out.length; i++) {
    let v = out[i];
    v = Math.max(v, maxVal - 8.0);
    v = (v + 4.0) / 4.0;
    out[i] = v;
  }
  return out;
}
