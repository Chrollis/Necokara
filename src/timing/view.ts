import type { Lyrics } from '../editor/lyrics';
import { isSpaceWord, isNewlineWord } from '../editor/word';
import type {
  TimingState,
  WordDisplayInfo,
  SyllableDisplayInfo,
} from './types';

export function buildTimingView(
  lyrics: Lyrics,
  state: TimingState,
): WordDisplayInfo[] {
  const result: WordDisplayInfo[] = [];
  let globalBeatIndex = 0;

  lyrics.words.forEach((word) => {
    if (isSpaceWord(word) || isNewlineWord(word)) {
      const syl = word.syllables[0];
      result.push({
        reading: isSpaceWord(word) ? ' ' : '\n',
        isSpace: isSpaceWord(word),
        isNewline: isNewlineWord(word),
        withRuby: false,
        syllables: [
          {
            beatIndex: -1,
            sylIndex: 0,
            reading: syl.reading,
            timeMs: syl.isSet ? syl.time.msec : null,
            isSet: syl.isSet,
            isSelected: false,
            isHighlighted:
              syl.isSet && state.currentPlayheadMs >= syl.time.msec,
          },
        ],
        isFullySet: syl.isSet,
        isPartiallySet: false,
        hasSelectedSyllable: false,
      });
      return;
    }

    const syllables: SyllableDisplayInfo[] = [];
    let hasSelected = false;
    let setCount = 0;

    word.syllables.forEach((syl, sylIdx) => {
      const { isSet, reading, time } = syl;
      const isSelected = globalBeatIndex === state.selectedBeatIndex;
      const isHighlighted = isSet && state.currentPlayheadMs >= time.msec;

      syllables.push({
        beatIndex: globalBeatIndex,
        sylIndex: sylIdx,
        reading,
        timeMs: isSet ? time.msec : null,
        isSet,
        isSelected,
        isHighlighted,
      });

      if (isSelected) hasSelected = true;
      if (isSet) setCount += 1;
      globalBeatIndex += 1;
    });

    result.push({
      reading: word.reading,
      isSpace: false,
      isNewline: false,
      withRuby: word.withRuby,
      syllables,
      isFullySet: setCount === word.syllables.length,
      isPartiallySet: setCount > 0 && setCount < word.syllables.length,
      hasSelectedSyllable: hasSelected,
    });
  });

  return result;
}
