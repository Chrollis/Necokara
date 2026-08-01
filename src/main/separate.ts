/**
 * separate.ts — MDX-Net vocal separation (onnxruntime + worker_threads).
 *
 * Reads the model dir / ffmpeg path from the resource config and runs
 * ffmpeg decode → separation in a Worker thread.
 */
import * as path from 'path';
import { Worker } from 'worker_threads';
import { getResourceConfig, findSeparateModel } from './resources';

function getWorkerPath(): string {
  const name = 'separate-worker';
  if (require('electron').app.isPackaged) {
    return path.join(__dirname, `${name}.js`);
  }
  return path.join(__dirname, `${name}.bundle.dev.js`);
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
  const modelFilePath = findSeparateModel(config.modelDir);
  if (!modelFilePath) {
    throw new Error('未找到人声分离模型，请先在「资源配置」中配置模型目录');
  }

  return new Promise((resolve, reject) => {
    const workerPath = getWorkerPath();
    const worker = new Worker(workerPath);

    worker.postMessage({
      audioData,
      sampleRate,
      modelFilePath,
      computeInstru: options.computeInstru,
      outputDir: options.outputDir ?? null,
      exportBaseName: options.exportBaseName ?? null,
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
        resolve({
          vocalsPath: String(result.vocalsPath ?? ''),
          exported: (result.exported ?? []) as string[],
        });
      }
    });

    worker.on('error', (err) => {
      worker.terminate();
      reject(err);
    });
  });
}
