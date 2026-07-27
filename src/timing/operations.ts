import type { Lyrics } from '../editor/lyrics';
import { isSeparatorWord } from '../editor/word';
import type { TimingState } from './types';
import { removePendingBeats } from './state';
import inferSeparatorTimes from './separator';

export function moveToNextBeat(
  state: TimingState,
  lyrics: Lyrics,
): TimingState {
  const beatRefs = lyrics.getBeatRefs();
  const maxIndex = beatRefs.length - 1;
  if (maxIndex < 0) return state;
  const nextIndex = Math.min(state.selectedBeatIndex + 1, maxIndex);
  if (nextIndex === state.selectedBeatIndex) return state;
  return { ...state, selectedBeatIndex: nextIndex };
}

export function moveToPrevBeat(state: TimingState): TimingState {
  if (state.selectedBeatIndex <= 0) return state;
  return { ...state, selectedBeatIndex: state.selectedBeatIndex - 1 };
}

export function moveToBeat(
  state: TimingState,
  beatIndex: number,
  lyrics: Lyrics,
): TimingState {
  const beatRefs = lyrics.getBeatRefs();
  if (beatIndex < 0 || beatIndex >= beatRefs.length) return state;
  return { ...state, selectedBeatIndex: beatIndex };
}

export function setBeatTime(
  lyrics: Lyrics,
  state: TimingState,
  timeMs: number,
): boolean {
  const beatRefs = lyrics.getBeatRefs();
  if (state.selectedBeatIndex < 0 || state.selectedBeatIndex >= beatRefs.length)
    return false;
  const ref = beatRefs[state.selectedBeatIndex];
  const word = lyrics.words[ref.wordIndex];
  if (isSeparatorWord(word)) return false;
  lyrics.setSyllableTime(ref.wordIndex, ref.sylIndex, { msec: timeMs });
  return true;
}

export function clearBeatTime(lyrics: Lyrics, state: TimingState): boolean {
  const beatRefs = lyrics.getBeatRefs();
  if (state.selectedBeatIndex < 0 || state.selectedBeatIndex >= beatRefs.length)
    return false;
  const ref = beatRefs[state.selectedBeatIndex];
  const word = lyrics.words[ref.wordIndex];
  if (isSeparatorWord(word)) return false;
  if (!word.syllables[ref.sylIndex].isSet) return false;
  lyrics.unsetSyllableTime(ref.wordIndex, ref.sylIndex);
  return true;
}

export function postSetBeat(
  lyrics: Lyrics,
  state: TimingState,
  changedBeatIndex: number,
): TimingState {
  const addToPending = inferSeparatorTimes(lyrics, changedBeatIndex);
  let newState = removePendingBeats(state, addToPending);
  const merged = mergePending(newState.pendingBeatIndices, addToPending);
  newState = removePendingBeats(newState, merged);
  if (merged.length > 0) {
    newState = { ...newState, pendingBeatIndices: merged };
  }
  return newState;
}

function mergePending(
  existing: readonly number[],
  newItems: readonly number[],
): number[] {
  const set = new Set(existing);
  newItems.forEach((item) => set.add(item));
  return Array.from(set);
}
