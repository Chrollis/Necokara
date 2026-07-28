import { contextBridge, ipcRenderer } from 'electron';
import IPC from '../shared/ipc';

let essentiaInstance: any = null;

function getEssentia() {
  if (essentiaInstance) return essentiaInstance;
  try {
    // @ts-ignore
    const { Essentia, EssentiaWASM } = __non_webpack_require__('essentia.js');
    essentiaInstance = new Essentia(EssentiaWASM);
    return essentiaInstance;
  } catch (e) {
    console.error('[preload] essentia load failed:', e);
    throw e;
  }
}

/** Detect BPM from raw PCM audio data (Float32Array). */
function detectBpmFromAudio(
  samples: Float32Array,
  sampleRate: number,
): {
  bpm: number;
  ticks: number[];
  segments: Array<{ bpm: number; start: number }>;
} | null {
  try {
    const instance = getEssentia();
    const vector = instance.arrayToVector(samples);
    const result = instance.RhythmExtractor2013(vector);

    const ticks: number[] = [];
    for (let i = 0; i < result.ticks.size(); i++) {
      ticks.push(result.ticks.get(i));
    }

    const bpm = Math.round(result.bpm * 10) / 10;
    const segments = segmentBpmChanges(ticks);

    return { bpm, ticks, segments };
  } catch {
    return null;
  }
}

function segmentBpmChanges(
  ticks: number[],
): Array<{ bpm: number; start: number }> {
  const windowSize = 8;
  const threshold = 0.15;

  if (ticks.length < windowSize * 2) {
    const intervals = [];
    for (let i = 1; i < ticks.length; i++)
      intervals.push(ticks[i] - ticks[i - 1]);
    const avg =
      intervals.reduce((a: number, b: number) => a + b, 0) / intervals.length;
    return [{ bpm: clampBpm(60000 / (avg * 1000)), start: 0 }];
  }

  const rawSegments: Array<{ bpm: number; start: number }> = [];
  let segStartIdx = 0;
  let segStartMs = 0;

  for (let i = windowSize; i < ticks.length - windowSize; i++) {
    const prevAvg =
      ticks
        .slice(i - windowSize, i)
        .reduce((a: number, b: number) => a + b, 0) / windowSize;
    const currAvg =
      ticks
        .slice(i, i + windowSize)
        .reduce((a: number, b: number) => a + b, 0) / windowSize;
    if (Math.abs(currAvg - prevAvg) / prevAvg > threshold) {
      const bpmVal = bpmFromTicks(ticks.slice(segStartIdx, i));
      if (bpmVal > 0)
        rawSegments.push({ bpm: bpmVal, start: Math.round(segStartMs) });
      segStartIdx = i;
      segStartMs = ticks[i] * 1000;
    }
  }

  const lastBpm = bpmFromTicks(ticks.slice(segStartIdx));
  if (lastBpm > 0)
    rawSegments.push({ bpm: lastBpm, start: Math.round(segStartMs) });

  if (rawSegments.length === 0)
    return [{ bpm: clampBpm(bpmFromTicks(ticks)), start: 0 }];

  // Merge adjacent segments with diff < 0.1
  const merged: Array<{ bpm: number; start: number }> = [];
  let cur = rawSegments[0],
    count = 1,
    sum = cur.bpm;
  for (let i = 1; i < rawSegments.length; i++) {
    const seg = rawSegments[i];
    if (Math.abs(seg.bpm - cur.bpm) < 0.1) {
      count++;
      sum += seg.bpm;
      cur = { bpm: sum / count, start: cur.start };
    } else {
      merged.push({ bpm: clampBpm(sum / count), start: cur.start });
      cur = seg;
      count = 1;
      sum = seg.bpm;
    }
  }
  merged.push({ bpm: clampBpm(sum / count), start: cur.start });
  return merged;
}

function bpmFromTicks(ticks: number[]): number {
  if (ticks.length < 2) return 0;
  const intervals: number[] = [];
  for (let i = 1; i < ticks.length; i++)
    intervals.push(ticks[i] - ticks[i - 1]);
  const sorted = intervals.sort((a, b) => a - b);
  return 60000 / (sorted[Math.floor(sorted.length / 2)] * 1000);
}

function clampBpm(bpm: number): number {
  return Math.max(20, Math.min(300, Math.round(bpm * 10) / 10));
}

const electronHandler = {
  audioAnalysis: {
    detectBpm: detectBpmFromAudio,
  },
  ipcRenderer: {
    send(channel: string, ...args: unknown[]) {
      ipcRenderer.send(channel, ...args);
    },
    on(channel: string, callback: (...args: unknown[]) => void) {
      const listener = (
        _event: Electron.IpcRendererEvent,
        ...args: unknown[]
      ) => callback(...args);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
    invoke(channel: string, ...args: unknown[]) {
      return ipcRenderer.invoke(channel, ...args);
    },
  },
  fs: {
    readTextFile(relativePath: string) {
      return ipcRenderer.invoke(IPC.READ_TEXT_FILE, relativePath);
    },
    readFileDataUrl(relativePath: string) {
      return ipcRenderer.invoke(IPC.READ_FILE_DATA_URL, relativePath);
    },
    fileExists(filePath: string) {
      return ipcRenderer.invoke(IPC.FILE_EXISTS, filePath);
    },
  },
  project: {
    save(data: string, currentPath?: string, password?: string) {
      return ipcRenderer.invoke(IPC.PROJECT_SAVE, data, currentPath, password);
    },
    saveDirect(data: string, filePath: string, password?: string) {
      return ipcRenderer.invoke(
        IPC.PROJECT_SAVE_DIRECT,
        data,
        filePath,
        password,
      );
    },
    open(password?: string) {
      return ipcRenderer.invoke(IPC.PROJECT_OPEN, password);
    },
    openPath(filePath: string, password?: string) {
      return ipcRenderer.invoke(IPC.PROJECT_OPEN_PATH, filePath, password);
    },
    openAudio() {
      return ipcRenderer.invoke(IPC.OPEN_AUDIO);
    },
  },
  window: {
    minimize() {
      ipcRenderer.send('window:minimize');
    },
    maximize() {
      ipcRenderer.send('window:maximize');
    },
    close() {
      ipcRenderer.send('window:close');
    },
    forceClose() {
      ipcRenderer.send('window:forceClose');
    },
    isMaximized() {
      return ipcRenderer.invoke('window:isMaximized');
    },
    onRequestClose(callback: () => void) {
      const sub = (_event: Electron.IpcRendererEvent) => callback();
      ipcRenderer.on('window:requestClose', sub);
      return () => ipcRenderer.removeListener('window:requestClose', sub);
    },
  },
};

contextBridge.exposeInMainWorld('electron', electronHandler);

export type ElectronHandler = typeof electronHandler;
