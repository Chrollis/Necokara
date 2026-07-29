/**
 * separate.ts — Vocal separation + onset detection via worker_threads.
 *
 * Spawns a Worker thread running pleco-xa REPET-SIM + onset_strength.
 * Returns vocals, accompaniment, and onset times.
 */

import * as path from 'path';
import { Worker } from 'worker_threads';

function getWorkerPath(): string {
  const name = 'separate-worker';
  if (require('electron').app.isPackaged) {
    return path.join(__dirname, `${name}.js`);
  }
  return path.join(__dirname, `${name}.bundle.dev.js`);
}

export interface SeparateResult {
  vocals: Float32Array;
  accompaniment: Float32Array;
  onsets: number[];
}

/**
 * Separate vocals and detect onsets via a Worker thread.
 */
export async function separate(
  audioData: Float32Array,
  sampleRate: number,
  onProgress?: (p: number) => void,
): Promise<SeparateResult | null> {
  return new Promise((resolve, reject) => {
    const workerPath = getWorkerPath();
    const worker = new Worker(workerPath);

    worker.postMessage({ audioData, sampleRate });

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
          vocals: new Float32Array(result.vocals),
          accompaniment: new Float32Array(result.accompaniment),
          onsets: result.onsets as number[],
        });
      }
    });

    worker.on('error', (err) => {
      worker.terminate();
      reject(err);
    });
  });
}
