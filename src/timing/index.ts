export type {
  TimingMode,
  TimingState,
  FineTuneState,
  BpmSegment,
  WordDisplayInfo,
  SyllableDisplayInfo,
} from './types';

export {
  createTimingState,
  createFineTuneState,
  setMode,
  setSelectedBeatIndex,
  setCurrentPlayheadMs,
  setIsPlaying,
  setAudioFilePath,
  addPendingBeat,
  removePendingBeat,
  removePendingBeats,
  clearPendingBeats,
} from './state';

export { buildTimingView, getBeatPositions } from './view';

export {
  moveToNextBeat,
  moveToPrevBeat,
  moveToBeat,
  setBeatTime,
  clearBeatTime,
  postSetBeat,
} from './operations';

export { default as inferSeparatorTimes } from './separator';

export {
  getBpmAtTime,
  snapToBpmGrid,
  dragBoundaryClampedTime,
} from './fineTune';

export { serializeTimingState, deserializeTimingState } from './serialization';
export type { SerializedTimingState } from './serialization';
