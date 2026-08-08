/**
 * separate.ts — Vocal separation via the Python backend (demucs).
 *
 * The renderer decodes audio to PCM; the main process writes it to a temp WAV
 * and spawns python/separate.py with the user-configured Python interpreter.
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  getResourceConfig,
  pythonScriptPath,
  validatePython,
} from './resources';

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

export interface SeparateOptions {
  computeInstru: boolean;
  outputDir?: string | null;
  exportBaseName?: string | null;
}

export interface SeparateResult {
  vocalsPath: string;
  exported: string[];
}

/**
 * Separate vocals from decoded PCM (renderer passes Float32Array channels).
 * @param audioData channel data (L/R or mono), source sample rate
 */
export async function separate(
  audioData: Float32Array[],
  sampleRate: number,
  options: SeparateOptions,
  onProgress?: (p: number) => void,
): Promise<SeparateResult | null> {
  const config = getResourceConfig();
  if (!config.pythonPath) {
    throw new Error('未配置 Python 解释器路径，请先在「资源配置」中配置');
  }
  const pythonCheck = await validatePython(config.pythonPath);
  if (!pythonCheck.ok) {
    throw new Error(`Python 不可用：${pythonCheck.error}`);
  }

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpInput = path.join(os.tmpdir(), `neco-sep-in-${stamp}.wav`);
  const hasExport = !!options.outputDir && !!options.exportBaseName;
  const outVocals = hasExport
    ? path.join(
        options.outputDir as string,
        `${options.exportBaseName}-vocal.wav`,
      )
    : path.join(os.tmpdir(), `neco-vocal-${stamp}.wav`);
  const outInstru = options.computeInstru
    ? hasExport
      ? path.join(
          options.outputDir as string,
          `${options.exportBaseName}-instru.wav`,
        )
      : path.join(os.tmpdir(), `neco-instru-${stamp}.wav`)
    : null;

  writeWavF32(tmpInput, audioData, sampleRate);

  const args = [
    pythonScriptPath('separate.py'),
    '--input',
    tmpInput,
    '--out-vocals',
    outVocals,
  ];
  if (outInstru) args.push('--out-instru', outInstru);

  return new Promise((resolve, reject) => {
    const child = spawn(config.pythonPath, args, {
      env: {
        ...process.env,
        HF_HUB_DISABLE_XET: '1',
        PYTHONIOENCODING: 'utf-8',
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      const text = d.toString('utf8');
      stderr += text;
      // python scripts report `PROGRESS <0..1>` on stderr; forward it
      for (const line of text.split('\n')) {
        const m = /^PROGRESS\s+([0-9.]+)/.exec(line.trim());
        if (m) onProgress?.(Math.min(1, Math.max(0, Number(m[1]))));
      }
    });
    child.on('error', (err) => {
      reject(err);
    });
    child.on('close', (code) => {
      try {
        fs.unlinkSync(tmpInput);
      } catch {
        /* ignore */
      }
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Python 分离失败（exit ${code}）`));
        return;
      }
      try {
        const payload = JSON.parse(stdout) as {
          ok: boolean;
          error?: string;
          vocals?: string;
          instru?: string | null;
        };
        if (!payload.ok) {
          reject(new Error(payload.error ?? 'Python 分离失败'));
          return;
        }
        const exported: string[] = [];
        if (payload.vocals) exported.push(payload.vocals);
        if (payload.instru) exported.push(payload.instru);
        resolve({ vocalsPath: payload.vocals ?? '', exported });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}
