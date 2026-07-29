/**
 * bpm.ts — BPM detection via worker_threads (pleco-xa).
 *
 * Spawns a Worker thread to run pleco-xa onset-based BPM detection,
 * keeping the renderer process responsive.
 */

import { app } from 'electron';
import * as path from 'path';
import { Worker } from 'worker_threads';

function getWorkerPath(): string {
  const name = 'bpm-worker';
  if (app.isPackaged) {
    return path.join(__dirname, `${name}.js`);
  }
  return path.join(__dirname, `${name}.bundle.dev.js`);
}

export interface BpmResult {
  bpm: number;
  ticks: number[];
  segments: Array<{ bpm: number; start: number }>;
}

export async function detectBpm(
  audioData: Float32Array,
  sampleRate: number,
): Promise<BpmResult | null> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(getWorkerPath());

    worker.postMessage({ audioData, sampleRate });

    worker.on('message', (result: any) => {
      worker.terminate();
      if (!result) resolve(null);
      else if (result.error) reject(new Error(result.error));
      else resolve(result as BpmResult);
    });

    worker.on('error', (err) => {
      worker.terminate();
      reject(err);
    });
  });
}
