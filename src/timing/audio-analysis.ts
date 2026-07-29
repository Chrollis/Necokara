/**
 * Renderer-side audio analysis.
 *
 * Vocal separation is performed in the main process via IPC (pleco-xa REPET-SIM).
 * Onsets are computed in the worker thread and returned alongside vocals.
 */
import type { BpmSegment } from './types';
import IPC, { decodeFloatArray } from '../shared/ipc';

export interface RhythmResult {
  bpm: number;
  ticks: number[];
  segments: BpmSegment[];
}

export async function detectRhythm(
  audioData: Float32Array,
  sampleRate: number,
): Promise<RhythmResult> {
  const result = (await window.electron.ipcRenderer.invoke(
    IPC.BPM_DETECT,
    audioData,
    sampleRate,
  )) as RhythmResult | { error: string } | null;

  if (!result) throw new Error('BPM detection returned null');
  if ('error' in result)
    throw new Error(`BPM detection failed: ${result.error}`);
  return result as RhythmResult;
}

/** Detect onsets from vocal-separated audio. */
export async function detectOnsets(
  audioData: Float32Array,
  sampleRate: number,
  onProgress?: (p: number) => void,
  audioFilePath?: string,
): Promise<number[]> {
  // Step 1: Set up progress listener
  let unsub: (() => void) | undefined;
  if (onProgress) {
    unsub = window.electron.ipcRenderer.on(
      IPC.SEPARATE_PROGRESS,
      (_pct: unknown) => {
        onProgress(_pct as number);
      },
    );
  }

  // Step 2: Separate vocals via main process (IPC, non-blocking)
  // Worker returns vocals, accompaniment, and onsets
  const sepResult = (await window.electron.ipcRenderer.invoke(
    IPC.SEPARATE_AUDIO,
    audioData,
    sampleRate,
    audioFilePath,
  )) as
    | {
        vocals: { type: string; data: number[] };
        accompaniment: { type: string; data: number[] };
        onsets: number[];
      }
    | { error: string }
    | null;

  unsub?.();

  if (!sepResult) throw new Error('Vocal separation returned null');
  if ('error' in sepResult)
    throw new Error(
      `Vocal separation failed: ${(sepResult as { error: string }).error}`,
    );

  // Onsets are already computed in the worker
  const onsets = (sepResult as any).onsets as number[];
  if (!onsets || onsets.length === 0)
    throw new Error('Onset detection returned null');

  return onsets;
}

export function segmentBpmChanges(
  ticks: number[],
  windowSize = 8,
  threshold = 0.15,
): BpmSegment[] {
  if (ticks.length < windowSize * 2) {
    const intervals = [];
    for (let i = 1; i < ticks.length; i++)
      intervals.push(ticks[i] - ticks[i - 1]);
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const bpm = Math.round(60000 / (avg * 1000));
    return [{ bpm: Math.max(20, Math.min(300, bpm)), start: 0 }];
  }

  const segments: BpmSegment[] = [];
  let segStartIdx = 0;
  let segStartMs = 0;

  for (let i = windowSize; i < ticks.length - windowSize; i++) {
    const prevAvg =
      ticks.slice(i - windowSize, i).reduce((a, b) => a + b, 0) / windowSize;
    const currAvg =
      ticks.slice(i, i + windowSize).reduce((a, b) => a + b, 0) / windowSize;
    if (Math.abs(currAvg - prevAvg) / prevAvg > threshold) {
      const bpm = bpmFromTicks(ticks.slice(segStartIdx, i));
      if (bpm > 0) segments.push({ bpm, start: Math.round(segStartMs) });
      segStartIdx = i;
      segStartMs = ticks[i] * 1000;
    }
  }

  const lastBpm = bpmFromTicks(ticks.slice(segStartIdx));
  if (lastBpm > 0)
    segments.push({ bpm: lastBpm, start: Math.round(segStartMs) });
  return segments.length > 0
    ? segments
    : [{ bpm: bpmFromTicks(ticks), start: 0 }];
}

function bpmFromTicks(ticks: number[]): number {
  if (ticks.length < 2) return 0;
  const intervals = [];
  for (let i = 1; i < ticks.length; i++)
    intervals.push(ticks[i] - ticks[i - 1]);
  const sorted = intervals.sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const bpm = Math.round(60000 / (median * 1000));
  return Math.max(20, Math.min(300, bpm));
}
