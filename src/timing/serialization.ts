import type { TimingState, BpmSegment, AudioMeta } from './types';
import { createTimingState, createFineTuneState } from './state';

export interface SerializedTimingState {
  audioFilePath: string;
  audioMeta: AudioMeta | null;
  bpmSegments: Array<{ bpm: number; start: number }>;
}

/** Runtime type guard — validates an unknown value is a valid SerializedTimingState */
export function isValidTimingData(
  raw: unknown,
): raw is Partial<SerializedTimingState> {
  if (!raw || typeof raw !== 'object') return false;
  const data = raw as Record<string, unknown>;
  // audioFilePath: optional string
  if (
    data.audioFilePath !== undefined &&
    typeof data.audioFilePath !== 'string'
  )
    return false;
  // audioMeta: optional object or null
  if (
    data.audioMeta !== undefined &&
    data.audioMeta !== null &&
    typeof data.audioMeta !== 'object'
  )
    return false;
  // bpmSegments: optional array of { bpm: number, start: number }
  if (data.bpmSegments !== undefined) {
    if (!Array.isArray(data.bpmSegments)) return false;
    for (const seg of data.bpmSegments) {
      if (!seg || typeof seg !== 'object') return false;
      const s = seg as Record<string, unknown>;
      if (typeof s.bpm !== 'number' || typeof s.start !== 'number')
        return false;
    }
  }
  return true;
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
