import type { Lyrics } from '../editor/lyrics';
import {
  isSeparatorWord,
  isNewlineWord,
  isPunctuationWord,
} from '../editor/word';

/**
 * Scan punctuation times (reverse, one pass). Punctuation has no musical
 * duration; its time is taken from the nearest following sung/separator word
 * that already has a time. Walking backwards lets a single pass fill chains
 * of punctuation regardless of interaction order.
 */
export function scanAllPunctuations(lyrics: Lyrics): void {
  let lastTime = -1;
  for (let k = lyrics.words.length - 1; k >= 0; k -= 1) {
    const word = lyrics.words[k];
    if (isPunctuationWord(word)) {
      if (lastTime >= 0) {
        word.syllables.forEach((_, si) => {
          lyrics.setSyllableTime(k, si, { msec: lastTime });
        });
      }
      continue;
    }
    const syl = word.syllables[0];
    if (syl && syl.isSet) {
      lastTime = syl.time.msec;
    }
  }
}

export default function inferSeparatorTimes(
  lyrics: Lyrics,
  changedBeatIndex: number,
  initMode: boolean = false,
): number[] {
  const addToPending: number[] = [];

  const beatRefs = lyrics.getBeatRefs();
  if (changedBeatIndex < 0 || changedBeatIndex >= beatRefs.length)
    return addToPending;

  const { wordIndex } = beatRefs[changedBeatIndex];

  if (wordIndex > 0 && isSeparatorWord(lyrics.words[wordIndex - 1])) {
    inferLeftSeparator(lyrics, wordIndex, addToPending, initMode);
  }

  if (
    wordIndex < lyrics.words.length - 1 &&
    isSeparatorWord(lyrics.words[wordIndex + 1])
  ) {
    inferRightSeparator(lyrics, wordIndex, addToPending, initMode);
  }

  return addToPending;
}

function inferLeftSeparator(
  lyrics: Lyrics,
  wordIndex: number,
  addToPending: number[],
  initMode: boolean,
): void {
  const leftWordIndex = wordIndex - 2;
  if (leftWordIndex < 0) return;

  const leftWord = lyrics.words[leftWordIndex];
  const rightWord = lyrics.words[wordIndex];
  if (isSeparatorWord(leftWord) || isSeparatorWord(rightWord)) return;

  const leftSyl = leftWord.syllables[leftWord.syllables.length - 1];
  const rightSyl = rightWord.syllables[0];

  if (leftSyl.isSet && rightSyl.isSet) {
    if (!initMode) {
      const avgTime = Math.floor((leftSyl.time.msec + rightSyl.time.msec) / 2);
      lyrics.setSyllableTime(wordIndex - 1, 0, { msec: avgTime });
    }
  } else if (rightSyl.isSet && !leftSyl.isSet) {
    const beatRefs = lyrics.getBeatRefs();
    for (let i = 0; i < beatRefs.length; i += 1) {
      const ref = beatRefs[i];
      if (
        ref.wordIndex === leftWordIndex &&
        ref.sylIndex === leftWord.syllables.length - 1
      ) {
        addToPending.push(i);
        break;
      }
    }
  }
}

function inferRightSeparator(
  lyrics: Lyrics,
  wordIndex: number,
  addToPending: number[],
  initMode: boolean,
): void {
  const separatorWord = lyrics.words[wordIndex + 1];
  const rightWordIndex = wordIndex + 2;
  const leftWord = lyrics.words[wordIndex];
  if (isSeparatorWord(leftWord)) return;

  const leftSyl = leftWord.syllables[leftWord.syllables.length - 1];

  if (isNewlineWord(separatorWord) && rightWordIndex >= lyrics.words.length) {
    if (leftSyl.isSet && !initMode) {
      lyrics.setSyllableTime(wordIndex + 1, 0, {
        msec: leftSyl.time.msec + 500,
      });
    }
    return;
  }

  if (rightWordIndex >= lyrics.words.length) return;
  const rightWord = lyrics.words[rightWordIndex];
  if (isSeparatorWord(rightWord)) return;

  const rightSyl = rightWord.syllables[0];

  if (leftSyl.isSet && rightSyl.isSet) {
    if (!initMode) {
      const avgTime = Math.floor((leftSyl.time.msec + rightSyl.time.msec) / 2);
      lyrics.setSyllableTime(wordIndex + 1, 0, { msec: avgTime });
    }
  } else if (leftSyl.isSet && !rightSyl.isSet) {
    const beatRefs = lyrics.getBeatRefs();
    for (let i = 0; i < beatRefs.length; i += 1) {
      if (
        beatRefs[i].wordIndex === rightWordIndex &&
        beatRefs[i].sylIndex === 0
      ) {
        addToPending.push(i);
        break;
      }
    }
  }
}
