import type { TimingMode, TimingState, FineTuneState } from './types';

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
): TimingState {
  return {
    mode,
    selectedBeatIndex,
    currentPlayheadMs: 0,
    isPlaying: false,
    fineTune,
    pendingBeatIndices,
    audioFilePath,
  };
}

export function setMode(state: TimingState, mode: TimingMode): TimingState {
  return { ...state, mode };
}

export function setSelectedBeatIndex(
  state: TimingState,
  selectedBeatIndex: number,
): TimingState {
  return { ...state, selectedBeatIndex };
}

export function setCurrentPlayheadMs(
  state: TimingState,
  currentPlayheadMs: number,
): TimingState {
  return { ...state, currentPlayheadMs };
}

export function setAudioFilePath(
  state: TimingState,
  audioFilePath: string,
): TimingState {
  return { ...state, audioFilePath };
}

export function setIsPlaying(
  state: TimingState,
  isPlaying: boolean,
): TimingState {
  return { ...state, isPlaying };
}

export function addPendingBeat(
  state: TimingState,
  beatIndex: number,
): TimingState {
  if (state.pendingBeatIndices.includes(beatIndex)) {
    return state;
  }
  return {
    ...state,
    pendingBeatIndices: [...state.pendingBeatIndices, beatIndex],
  };
}

export function removePendingBeat(
  state: TimingState,
  beatIndex: number,
): TimingState {
  return {
    ...state,
    pendingBeatIndices: state.pendingBeatIndices.filter(
      (idx) => idx !== beatIndex,
    ),
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

export function clearPendingBeats(state: TimingState): TimingState {
  return { ...state, pendingBeatIndices: [] };
}
