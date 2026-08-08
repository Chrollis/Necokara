/**
 * Renderer-side audio analysis.
 *
 * BPM detection runs in the main process via IPC (pleco worker).
 */
import type { BpmSegment } from './types';
import type { WhisperSegment } from '../shared/whisper-types';
import IPC from '../shared/ipc';

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

export interface SeparateAudioOptions {
  computeInstru: boolean;
  outputDir?: string | null;
  exportBaseName?: string | null;
}

export interface SeparateResult {
  vocalsPath: string;
  exported: string[];
}

export interface AutoTimingCheckResult {
  pythonOk: boolean;
  ffmpegOk: boolean;
  whisperLanguages: Array<{ code: string; id: number }>;
}

/**
 * Separate vocals in the main process (MDX-Net worker) from decoded PCM.
 * @returns separated vocals temp wav path + exported files
 */
export async function separateVocals(
  audioData: Float32Array[],
  sampleRate: number,
  options: SeparateAudioOptions,
  onProgress?: (p: number) => void,
): Promise<SeparateResult> {
  let unsub: (() => void) | undefined;
  if (onProgress) {
    unsub = window.electron.ipcRenderer.on(
      IPC.SEPARATE_PROGRESS,
      (_p: unknown) => {
        onProgress(_p as number);
      },
    );
  }
  const res = (await window.electron.ipcRenderer.invoke(
    IPC.SEPARATE_AUDIO,
    audioData,
    sampleRate,
    options,
  )) as { vocalsPath: string; exported: string[] } | { error: string } | null;
  unsub?.();
  if (!res) throw new Error('Vocal separation returned null');
  if ('error' in res) throw new Error(`Vocal separation failed: ${res.error}`);
  return res;
}

/**
 * Force-align separated vocals to the user's lyrics in the main process.
 * @param clean optional noise-gate settings for instrumental residue
 * @param lyricsText full lyrics (syllable.reading concat) to force-align
 * @returns timestamped segments + per-lyric-char times (charTimesMap)
 */
export async function alignVocals(
  vocalsPath: string,
  languageToken: number,
  lyricsText: string,
  clean?: { enabled: boolean; threshold: number },
  onProgress?: (p: number) => void,
): Promise<{
  segments: WhisperSegment[];
  charTimesMap?: Record<string, number>;
}> {
  let unsub: (() => void) | undefined;
  if (onProgress) {
    unsub = window.electron.ipcRenderer.on(
      IPC.WHISPER_ALIGN_PROGRESS,
      (_p: unknown) => {
        onProgress(_p as number);
      },
    );
  }
  const res = (await window.electron.ipcRenderer.invoke(
    IPC.WHISPER_ALIGN,
    vocalsPath,
    languageToken,
    clean,
    lyricsText,
  )) as
    | {
        segments: WhisperSegment[];
        charTimesMap?: Record<string, number>;
      }
    | { error: string }
    | null;
  unsub?.();
  if (!res) throw new Error('Alignment returned null');
  if ('error' in res) throw new Error(`Alignment failed: ${res.error}`);
  return {
    segments: res.segments,
    charTimesMap: res.charTimesMap,
  };
}

/** Read an audio file into an ArrayBuffer (decoded on the renderer side). */
export async function readAudioBuffer(
  audioFilePath: string,
): Promise<ArrayBuffer> {
  const res = (await window.electron.ipcRenderer.invoke(
    IPC.AUDIO_READ_BUFFER,
    audioFilePath,
  )) as { data: ArrayBuffer } | { error: string } | null;
  if (!res) throw new Error('Read audio returned null');
  if ('error' in res) throw new Error(`Read audio failed: ${res.error}`);
  return res.data;
}

/** Read a WAV header (sample rate + frame count) via the main process. */
export async function getWavInfo(
  filePath: string,
): Promise<{ sampleRate: number; frames: number } | null> {
  const res = (await window.electron.ipcRenderer.invoke(
    IPC.AUDIO_WAV_INFO,
    filePath,
  )) as { sampleRate: number; frames: number } | { error: string } | null;
  if (!res || 'error' in res) return null;
  return res;
}

/** Preflight check for auto timing (python + ffmpeg availability). */
export async function checkAutoTiming(): Promise<AutoTimingCheckResult> {
  const res = (await window.electron.ipcRenderer.invoke(
    IPC.AUTO_TIMING_CHECK,
  )) as AutoTimingCheckResult;
  return res;
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
