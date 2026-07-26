import type {
  TimingMode,
  TimingState,
  FineTuneState,
  BpmSegment,
} from './types';
import { createTimingState, createFineTuneState } from './state';

export interface SerializedTimingState {
  mode: TimingMode;
  selectedBeatIndex: number;
  audioFilePath: string;
  fineTune: {
    bpmSegments: Array<{ bpm: number; start: number }>;
    zoomLevel: number;
    scrollOffset: number;
  };
}

export function serializeTimingState(
  state: TimingState,
): SerializedTimingState {
  return {
    mode: state.mode,
    selectedBeatIndex: state.selectedBeatIndex,
    audioFilePath: state.audioFilePath,
    fineTune: {
      bpmSegments: state.fineTune.bpmSegments.map((seg) => ({
        bpm: seg.bpm,
        start: seg.start,
      })),
      zoomLevel: state.fineTune.zoomLevel,
      scrollOffset: state.fineTune.scrollOffset,
    },
  };
}

export function deserializeTimingState(
  data: Partial<SerializedTimingState>,
  beatCount: number = 0,
): TimingState {
  const mode: TimingMode =
    data.mode === 'sequential' || data.mode === 'fineTune'
      ? data.mode
      : 'sequential';

  const selectedBeatIndex =
    data.selectedBeatIndex !== undefined &&
    data.selectedBeatIndex >= 0 &&
    data.selectedBeatIndex < beatCount
      ? data.selectedBeatIndex
      : 0;

  const audioFilePath =
    typeof data.audioFilePath === 'string' ? data.audioFilePath : '';
  const fineTune = deserializeFineTuneState(data.fineTune);

  return createTimingState(
    mode,
    selectedBeatIndex,
    fineTune,
    [],
    audioFilePath,
  );
}

function deserializeFineTuneState(
  data: Partial<SerializedTimingState['fineTune']> | undefined,
): FineTuneState {
  if (!data) return createFineTuneState();

  let bpmSegments: BpmSegment[] = [];
  if (Array.isArray(data.bpmSegments)) {
    bpmSegments = data.bpmSegments
      .filter(
        (seg): seg is { bpm: number; start: number } =>
          typeof seg.bpm === 'number' && typeof seg.start === 'number',
      )
      .map((seg) => ({
        bpm: seg.bpm < 0 ? 0 : Math.round(seg.bpm),
        start: Math.max(0, Math.round(seg.start)),
      }))
      .sort((a, b) => a.start - b.start);
  }

  const zoomLevel =
    typeof data.zoomLevel === 'number' && data.zoomLevel > 0
      ? data.zoomLevel
      : 1.0;

  const scrollOffset =
    typeof data.scrollOffset === 'number' && data.scrollOffset >= 0
      ? data.scrollOffset
      : 0;

  return createFineTuneState(bpmSegments, zoomLevel, scrollOffset);
}
