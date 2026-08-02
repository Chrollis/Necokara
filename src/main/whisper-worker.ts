/**
 * whisper-worker.ts — Whisper alignment worker (onnxruntime).
 *
 * Input: { vocalsPath, modelDir, languageToken }
 * Flow: parse vocals wav → resample 16k mono → loadWhisperModel → transcribeAudio
 * Output: { segments } | { progress } | { error }
 */
import { parentPort } from 'worker_threads';
import * as fs from 'fs';
import { loadWhisperModel, transcribeAudio } from '../timing/whisper/index';
import { cleanVocal, trimSegmentSilence } from '../timing/whisper/clean';
import { segmentWordTimes } from '../timing/whisper/wordtimestamps';

/** Parse a RIFF WAV file (float32 or PCM16). */
function readWav(filePath: string): {
  channels: Float32Array[];
  sampleRate: number;
} {
  const buf = fs.readFileSync(filePath);
  const numCh = buf.readUInt16LE(22);
  const sr = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);
  const audioFormat = buf.readUInt16LE(20);

  let dataOffset = 12;
  let dataLen = 0;
  while (dataOffset + 8 <= buf.length) {
    const id = buf.toString('ascii', dataOffset, dataOffset + 4);
    const sz = buf.readUInt32LE(dataOffset + 4);
    if (id === 'data') {
      dataOffset += 8;
      dataLen = sz;
      break;
    }
    dataOffset += 8 + sz;
  }

  const bytesPerSample = bitsPerSample / 8;
  const frames = Math.floor(dataLen / (numCh * bytesPerSample));
  const channels: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) channels.push(new Float32Array(frames));

  if (audioFormat === 3) {
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < numCh; c++) {
        channels[c][i] = buf.readFloatLE(dataOffset + (i * numCh + c) * 4);
      }
    }
  } else {
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < numCh; c++) {
        channels[c][i] =
          buf.readInt16LE(dataOffset + (i * numCh + c) * 2) / 32768;
      }
    }
  }
  return { channels, sampleRate: sr };
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

parentPort?.on(
  'message',
  async (msg: {
    vocalsPath: string;
    modelDir: string;
    languageToken: number;
    clean?: { enabled: boolean; threshold: number };
  }) => {
    try {
      const { vocalsPath, modelDir, languageToken, clean } = msg;
      if (!vocalsPath || !modelDir) {
        parentPort?.postMessage({ error: '缺少 vocals / 模型目录配置' });
        return;
      }

      const { channels, sampleRate } = readWav(vocalsPath);
      if (channels.length === 0 || channels[0].length === 0) {
        parentPort?.postMessage({ error: 'vocals 音频为空' });
        return;
      }
      // downmix to mono → resample 16k
      const n = channels[0].length;
      const mono = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let c = 0; c < channels.length; c++) s += channels[c][i];
        mono[i] = s / channels.length;
      }
      const audio = resample(mono, sampleRate, 16000);
      // optional noise gate: drop low-energy instrumental residue so Whisper
      // starts at the real vocal onset (fixes early-timing bias)
      const cleaned = cleanVocal(audio, {
        enabled: clean?.enabled ?? false,
        threshold: clean?.threshold ?? 20,
      });

      const model = await loadWhisperModel(modelDir);
      const segments = await transcribeAudio(model, cleaned, {
        languageToken,
        onProgress: (p) => parentPort?.postMessage({ progress: p }),
      });
      // trim leading silence off each segment (whisper starts first segment at
      // window origin even when there is instrumental residue before the voice)
      const trimmed = trimSegmentSilence(segments, cleaned);
      // recompute word-level timestamps AFTER trimming so they use the final
      // seg.start/end (the trim shifts seg.start but not the window origin)
      const tsBegin = model.tokenizer.specials.timestampBegin;
      for (const s of trimmed) {
        s.wordTimes = segmentWordTimes(s, s.windowOffset ?? 0, tsBegin, (t) =>
          model.tokenizer.decode(t),
        );
      }

      parentPort?.postMessage({ segments: trimmed });
    } catch (err) {
      parentPort?.postMessage({ error: String(err) });
    }
  },
);
