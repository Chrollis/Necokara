/**
 * separate-worker.ts — MDX-Net vocal separation worker (onnxruntime).
 *
 * Pipeline: resample to stereo 44.1k → chunked STFT → MDX inference → ISTFT
 *           → vocals / (on-demand) accompaniment
 * Input: { audioData, sampleRate, modelFilePath, computeInstru, outputDir?, exportBaseName? }
 * Output: { progress } | { error } | { vocalsPath, exported }
 */
import { parentPort } from 'worker_threads';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { stft, istft, hannWindow } from '../timing/fft';
import { createSession, loadOnnx } from '../timing/onnx';

const SR = 44100;
const N_FFT = 6144;
const HOP = 1024;
const DIM_F = 3072;
const DIM_T = 256;
const CHUNK_SIZE = HOP * (DIM_T - 1); // 261120
const TRIM = N_FFT / 2; // 3072
const GEN_SIZE = CHUNK_SIZE - 2 * TRIM; // 254976
const BIG_CHUNK = 15 * SR;
const MARGIN = SR;
const WIN = hannWindow(N_FFT);

/** Write a mono/stereo float32 PCM WAV file (interleaved). */
function writeWavF32(
  filePath: string,
  channels: Float32Array[],
  sr: number,
): void {
  const numCh = channels.length;
  const frames = channels[0].length;
  const dataLen = frames * numCh * 4;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(3, 20); // IEEE float
  buf.writeUInt16LE(numCh, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * numCh * 4, 28);
  buf.writeUInt16LE(numCh * 4, 32);
  buf.writeUInt16LE(32, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataLen, 40);
  let off = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      buf.writeFloatLE(channels[c][i], off);
      off += 4;
    }
  }
  fs.writeFileSync(filePath, buf);
}

/** Linear-interpolation resample. */
function resample(
  data: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate) return data;
  const ratio = toRate / fromRate;
  const newLen = Math.max(1, Math.round(data.length * ratio));
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

/** 解析模型输出 [1,4,3072,256] → 单声道谱（补 Nyquist 到 3073 行） */
function parseOutput(o: Float32Array, chReal: number, chImag: number) {
  const nBins = N_FFT / 2 + 1;
  const mat: { real: number; imag: number }[][] = [];
  for (let f = 0; f < nBins; f++) {
    const row: { real: number; imag: number }[] = [];
    for (let t = 0; t < DIM_T; t++) {
      row.push(
        f < DIM_F
          ? {
              real: o[(chReal * DIM_F + f) * DIM_T + t],
              imag: o[(chImag * DIM_F + f) * DIM_T + t],
            }
          : { real: 0, imag: 0 },
      );
    }
    mat.push(row);
  }
  return mat;
}

parentPort?.on(
  'message',
  async (msg: {
    audioData: Float32Array[];
    sampleRate: number;
    modelFilePath: string;
    computeInstru: boolean;
    outputDir?: string | null;
    exportBaseName?: string | null;
  }) => {
    const oldPriority = (process as any).priority;
    try {
      (process as any).priority = 6;
      const {
        audioData,
        sampleRate,
        modelFilePath,
        computeInstru,
        outputDir,
        exportBaseName,
      } = msg;

      if (!modelFilePath || !audioData || audioData.length === 0) {
        parentPort?.postMessage({ error: '缺少模型 / 音频数据配置' });
        return;
      }

      // 1. resample input → stereo 44.1k
      const L = resample(audioData[0], sampleRate, SR);
      const R =
        audioData.length >= 2
          ? resample(audioData[1], sampleRate, SR)
          : new Float32Array(L);
      const n = L.length;
      if (n < SR) {
        parentPort?.postMessage({ error: '音频过短' });
        return;
      }

      // 2. onnx session (auto GPU: DirectML when available, else CPU)
      const session = await createSession(modelFilePath);
      const ort = loadOnnx();

      // 3. 两层切块分离（外层 15s 大块 + 1s margin，内层 gen_size 子块 + trim）
      const vL = new Float64Array(n);
      const vR = new Float64Array(n);
      let segCounter = 0;
      for (let skip = 0; skip < n; skip += BIG_CHUNK) {
        const sMargin = segCounter === 0 ? 0 : MARGIN;
        const segStart = skip - sMargin;
        const segEnd = Math.min(skip + BIG_CHUNK + MARGIN, n);
        const segLen = segEnd - segStart;
        const outL = new Float64Array(segLen);
        const outR = new Float64Array(segLen);
        const subChunks = Math.ceil(segLen / GEN_SIZE);
        for (let c = 0; c < subChunks; c++) {
          const start = c * GEN_SIZE;
          const chunkL = new Float32Array(CHUNK_SIZE);
          const chunkR = new Float32Array(CHUNK_SIZE);
          for (let i = 0; i < CHUNK_SIZE; i++) {
            const idx = segStart + start + i - TRIM;
            if (idx >= 0 && idx < n) {
              chunkL[i] = L[idx];
              chunkR[i] = R[idx];
            }
          }
          // STFT → [1,4,3072,256] 输入（通道 realL,imagL,realR,imagR）
          const sl = stft(chunkL, N_FFT, HOP, WIN);
          const srch = stft(chunkR, N_FFT, HOP, WIN);
          const inp = new Float32Array(4 * DIM_F * DIM_T);
          for (let t = 0; t < DIM_T; t++) {
            for (let f = 0; f < DIM_F; f++) {
              inp[(0 * DIM_F + f) * DIM_T + t] = sl[f][t].real;
              inp[(1 * DIM_F + f) * DIM_T + t] = sl[f][t].imag;
              inp[(2 * DIM_F + f) * DIM_T + t] = srch[f][t].real;
              inp[(3 * DIM_F + f) * DIM_T + t] = srch[f][t].imag;
            }
          }
          const out = await session.run({
            input: new ort.Tensor('float32', inp, [1, 4, DIM_F, DIM_T]),
          });
          const o = out.output.data as Float32Array;
          const wL = istft(parseOutput(o, 0, 1), HOP, WIN, CHUNK_SIZE);
          const wR = istft(parseOutput(o, 2, 3), HOP, WIN, CHUNK_SIZE);
          for (let i = TRIM; i < CHUNK_SIZE - TRIM; i++) {
            const oi = start + (i - TRIM);
            if (oi >= 0 && oi < segLen) {
              outL[oi] += wL[i];
              outR[oi] += wR[i];
            }
          }
        }
        // 只保留段内可靠中间部分（去掉 margin 边缘）
        const keepStart = segCounter === 0 ? 0 : MARGIN;
        const keepEnd = segEnd === n ? segLen : segLen - MARGIN;
        for (let i = keepStart; i < keepEnd; i++) {
          const oi = segStart + i;
          if (oi >= 0 && oi < n) {
            vL[oi] = outL[i];
            vR[oi] = outR[i];
          }
        }
        segCounter++;
        parentPort?.postMessage({
          progress: Math.min(1, (skip + BIG_CHUNK) / n),
        });
      }

      const vocalsL = Float32Array.from(vL);
      const vocalsR = Float32Array.from(vR);

      // 4. accompaniment only when requested
      let accL: Float32Array | null = null;
      let accR: Float32Array | null = null;
      if (computeInstru) {
        accL = new Float32Array(n);
        accR = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          accL[i] = L[i] - vocalsL[i];
          accR[i] = R[i] - vocalsR[i];
        }
      }

      // 5. temp vocals wav (mono 44.1k) for whisper alignment
      const mono = new Float32Array(n);
      for (let i = 0; i < n; i++) mono[i] = (vocalsL[i] + vocalsR[i]) * 0.5;
      const vocalsPath = path.join(
        os.tmpdir(),
        `necokara-vocals-${Date.now()}-${process.pid}.wav`,
      );
      writeWavF32(vocalsPath, [mono], SR);

      // 6. export vocals/instru to the source audio dir
      const exported: string[] = [];
      if (outputDir && exportBaseName) {
        const vocalFile = path.join(outputDir, `${exportBaseName}-vocal.wav`);
        writeWavF32(vocalFile, [vocalsL, vocalsR], SR);
        exported.push(vocalFile);
        if (accL && accR) {
          const instruFile = path.join(
            outputDir,
            `${exportBaseName}-instru.wav`,
          );
          writeWavF32(instruFile, [accL, accR], SR);
          exported.push(instruFile);
        }
      }

      parentPort?.postMessage({ vocalsPath, exported });
    } catch (err) {
      parentPort?.postMessage({ error: String(err) });
    } finally {
      (process as any).priority = oldPriority;
    }
  },
);
