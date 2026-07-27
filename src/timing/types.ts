export type TimingMode = 'sequential' | 'fineTune';

export interface BpmSegment {
  bpm: number;
  start: number;
}

export interface FineTuneState {
  bpmSegments: BpmSegment[];
  zoomLevel: number;
  scrollOffset: number;
}

export interface AudioMeta {
  duration: number;
  fileSize: number;
}

export interface TimingState {
  mode: TimingMode;
  selectedBeatIndex: number;
  currentPlayheadMs: number;
  isPlaying: boolean;
  fineTune: FineTuneState;
  pendingBeatIndices: number[];
  audioFilePath: string;
  audioMeta: AudioMeta | null;
}

export interface SyllableDisplayInfo {
  beatIndex: number;
  sylIndex: number;
  reading: string;
  timeMs: number | null;
  isSet: boolean;
  isSelected: boolean;
  isHighlighted: boolean;
}

export interface WordDisplayInfo {
  reading: string;
  isSpace: boolean;
  isNewline: boolean;
  withRuby: boolean;
  syllables: SyllableDisplayInfo[];
  isFullySet: boolean;
  isPartiallySet: boolean;
  hasSelectedSyllable: boolean;
}
