import type {
  TimingMode,
  TimingState,
  FineTuneState,
  AudioMeta,
} from './types';

export function createFineTuneState(
  bpmSegments: FineTuneState['bpmSegments'] = [],
  zoomLevel: number = 1.0,
  scrollOffset: number = 0,
): FineTuneState {
  return { bpmSegments, zoomLevel, scrollOffset };
}

export function createTimingState(
  mode: TimingMode = 'sequential',
  selectedBeatIndex: number = 0,
  fineTune: FineTuneState = createFineTuneState(),
  pendingBeatIndices: number[] = [],
  audioFilePath: string = '',
  audioMeta: AudioMeta | null = null,
): TimingState {
  return {
    mode,
    selectedBeatIndex,
    currentPlayheadMs: 0,
    isPlaying: false,
    fineTune,
    pendingBeatIndices,
    audioFilePath,
    audioMeta,
  };
}

export function removePendingBeats(
  state: TimingState,
  beatIndices: number[],
): TimingState {
  const removeSet = new Set(beatIndices);
  return {
    ...state,
    pendingBeatIndices: state.pendingBeatIndices.filter(
      (idx) => !removeSet.has(idx),
    ),
  };
}
