import type { TimingState, BpmSegment, AudioMeta } from './types';
import { createTimingState, createFineTuneState } from './state';

export interface SerializedTimingState {
  audioFilePath: string;
  audioMeta: AudioMeta | null;
  bpmSegments: Array<{ bpm: number; start: number }>;
}

function parseAudioMeta(raw: unknown): AudioMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.duration !== 'number' || typeof obj.fileSize !== 'number')
    return null;
  return { duration: obj.duration, fileSize: obj.fileSize };
}

export function serializeTimingState(
  state: TimingState,
): SerializedTimingState {
  return {
    audioFilePath: state.audioFilePath,
    audioMeta: state.audioMeta,
    bpmSegments: state.fineTune.bpmSegments.map((seg) => ({
      bpm: seg.bpm,
      start: seg.start,
    })),
  };
}

export function deserializeTimingState(
  data: Partial<SerializedTimingState>,
  beatCount: number = 0,
): TimingState {
  const audioFilePath =
    typeof data.audioFilePath === 'string' ? data.audioFilePath : '';
  const audioMeta = parseAudioMeta(data.audioMeta);

  let bpmSegments: BpmSegment[] = [];
  if (Array.isArray(data.bpmSegments)) {
    bpmSegments = data.bpmSegments
      .filter(
        (seg): seg is { bpm: number; start: number } =>
          typeof seg.bpm === 'number' && typeof seg.start === 'number',
      )
      .map((seg) => ({
        bpm: seg.bpm < 0 ? 0 : Math.round(seg.bpm * 10) / 10,
        start: Math.max(0, Math.round(seg.start)),
      }))
      .sort((a, b) => a.start - b.start);
  }

  const fineTune = createFineTuneState(bpmSegments);

  return createTimingState(
    'sequential',
    0,
    fineTune,
    [],
    audioFilePath,
    audioMeta,
  );
}
