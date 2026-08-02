/**
 * whisper.ts — Whisper alignment (onnxruntime + worker_threads).
 *
 * Reads the model dir from the resource config and runs whisper transcription
 * (self-parsed vocals wav) in a Worker thread.
 */
import * as path from 'path';
import { Worker } from 'worker_threads';
import { getResourceConfig, findWhisperModel } from './resources';
import type { WhisperSegment } from '../timing/whisper/transcribe';

function getWorkerPath(): string {
  const name = 'whisper-worker';
  if (require('electron').app.isPackaged) {
    return path.join(__dirname, `${name}.js`);
  }
  return path.join(__dirname, `${name}.bundle.dev.js`);
}

export interface AlignResult {
  segments: WhisperSegment[];
}

/**
 * Transcribe separated vocals to timestamped segments via a Worker thread.
 * @param vocalsPath path to the separated vocals wav
 * @param languageToken whisper language token id (e.g. <|ja|>)
 * @param clean optional noise-gate settings for instrumental residue
 */
export async function alignVocal(
  vocalsPath: string,
  languageToken: number,
  clean?: { enabled: boolean; threshold: number },
  onProgress?: (p: number) => void,
): Promise<AlignResult | null> {
  const config = getResourceConfig();
  const modelDir = findWhisperModel(config.modelDir);
  if (!modelDir) {
    throw new Error(
      '未找到 whisper 对齐模型，请先在「资源配置」中配置模型目录',
    );
  }

  return new Promise((resolve, reject) => {
    const workerPath = getWorkerPath();
    const worker = new Worker(workerPath);

    worker.postMessage({
      vocalsPath,
      modelDir,
      languageToken,
      clean,
    });

    worker.on('message', (result: any) => {
      if (result && typeof result.progress === 'number') {
        onProgress?.(result.progress);
        return;
      }
      worker.terminate();
      if (!result) {
        resolve(null);
      } else if (result.error) {
        reject(new Error(result.error));
      } else {
        resolve({ segments: result.segments as WhisperSegment[] });
      }
    });

    worker.on('error', (err) => {
      worker.terminate();
      reject(err);
    });
  });
}
