import { useEffect } from 'react';
import type { Lyrics } from '../../../editor/lyrics';
import type { TimingState } from '../../../timing/types';
import { moveToNextBeat, moveToPrevBeat } from '../../../timing/operations';

interface UseTimingKeyboardOptions {
  handleSetBeat: () => void;
  handleClearBeat: () => void;
  togglePlay: () => void;
  updateState: (state: TimingState) => void;
  state: TimingState;
  lyrics: Lyrics;
  setVerticalZoom: React.Dispatch<React.SetStateAction<number>>;
  setVerticalOffset: React.Dispatch<React.SetStateAction<number>>;
  timelineView?: boolean;
}

export default function useTimingKeyboard({
  handleSetBeat,
  handleClearBeat,
  togglePlay,
  updateState,
  state,
  lyrics,
  setVerticalZoom,
  setVerticalOffset,
  timelineView,
}: UseTimingKeyboardOptions): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      // Prevent beat/card shortcuts in timeline view
      const isBeatShortcut =
        e.key === ' ' ||
        e.key === 'Enter' ||
        e.key === 'Backspace' ||
        e.key === 'Delete' ||
        e.key === 'ArrowRight' ||
        e.key === 'ArrowLeft';
      if (timelineView && isBeatShortcut) return;

      if (e.key === ' ') {
        e.preventDefault();
        handleSetBeat();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleSetBeat();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        handleClearBeat();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        updateState(moveToNextBeat(state, lyrics));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        updateState(moveToPrevBeat(state));
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        setVerticalZoom((z) => Math.max(0.1, z - 0.2));
      } else if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        setVerticalZoom((z) => Math.min(5, z + 0.2));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setVerticalOffset((o) => o + 10);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setVerticalOffset((o) => o - 10);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [
    handleSetBeat,
    handleClearBeat,
    togglePlay,
    state,
    lyrics,
    updateState,
    setVerticalZoom,
    setVerticalOffset,
  ]);
}
