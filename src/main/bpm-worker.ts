/**
 * bpm-worker.ts — Worker thread for pleco-xa BPM detection.
 */

import { parentPort } from 'worker_threads';

parentPort?.on(
  'message',
  async (msg: { audioData: Float32Array; sampleRate: number }) => {
    const oldPriority = (process as any).priority;
    try {
      (process as any).priority = 6;

      const { audioData, sampleRate } = msg;

      const [plecoBpm, pleco] = await Promise.all([
        import('pleco-xa/bpm'),
        import('pleco-xa'),
      ]);

      const analysis = await plecoBpm.analyzeWithProgress(
        audioData,
        sampleRate,
      );
      const globalTempo = analysis.globalTempo;

      if (!globalTempo || globalTempo <= 0) {
        parentPort?.postMessage({ error: 'BPM detection failed' });
        return;
      }

      const bpm = Math.round(globalTempo * 10) / 10;

      // Generate beat ticks from tempo + onset envelope
      // Use onsetDetect for tick positions, but filter by BPM
      const onsetResult = pleco.onsetDetect(audioData, sampleRate, {
        hopLength: 512,
        frameLength: 2048,
        delta: 0.5,
        wait: 6,
      });
      const onsetTimes: number[] = onsetResult.onsetTimes;

      // Build segments from per-window tempo array
      const segments = buildSegments(analysis);

      parentPort?.postMessage({ bpm, ticks: onsetTimes, segments });
    } catch (err) {
      parentPort?.postMessage({ error: String(err) });
    } finally {
      (process as any).priority = oldPriority;
    }
  },
);

function buildSegments(analysis: any): Array<{ bpm: number; start: number }> {
  const { tempo, times } = analysis;
  if (!tempo || tempo.length === 0) {
    const bpm = Math.round(analysis.globalTempo * 10) / 10;
    return [{ bpm, start: 0 }];
  }

  const segments: Array<{ bpm: number; start: number }> = [];
  let segStart = times[0] * 1000;
  let segBpm = Math.round(tempo[0] * 10) / 10;
  let count = 1;
  let sum = tempo[0];

  for (let i = 1; i < tempo.length; i++) {
    const curr = Math.round(tempo[i] * 10) / 10;
    if (Math.abs(curr - segBpm) > 5) {
      // BPM changed significantly
      segments.push({
        bpm: Math.round((sum / count) * 10) / 10,
        start: Math.round(segStart),
      });
      segStart = times[i] * 1000;
      segBpm = curr;
      count = 1;
      sum = tempo[i];
    } else {
      count++;
      sum += tempo[i];
    }
  }
  segments.push({
    bpm: Math.round((sum / count) * 10) / 10,
    start: Math.round(segStart),
  });

  // Merge adjacent segments with small BPM diff
  if (segments.length > 1) {
    const merged: Array<{ bpm: number; start: number }> = [segments[0]];
    for (let i = 1; i < segments.length; i++) {
      const last = merged[merged.length - 1];
      if (Math.abs(segments[i].bpm - last.bpm) < 5) {
        merged[merged.length - 1] = {
          bpm: Math.round(((last.bpm + segments[i].bpm) / 2) * 10) / 10,
          start: last.start,
        };
      } else {
        merged.push(segments[i]);
      }
    }
    return merged;
  }

  return segments;
}
