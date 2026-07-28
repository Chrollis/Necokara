/**
 * Renderer-side audio analysis.
 *
 * Delegates essentia.js BPM detection to the preload script via contextBridge.
 */
import type { BpmSegment } from './types';

export interface RhythmResult {
  bpm: number;
  ticks: number[];
  segments: BpmSegment[];
}

export async function detectRhythm(
  audioData: Float32Array,
  sampleRate: number,
): Promise<RhythmResult> {
  const fn = window.electron?.audioAnalysis?.detectBpm;
  if (!fn) throw new Error('BPM detection not available');
  const result = fn(audioData, sampleRate);
  if (!result) throw new Error('BPM detection returned null');
  return result as RhythmResult;
  return result as RhythmResult;
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
