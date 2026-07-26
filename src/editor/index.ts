export type { Time } from './time';
export {
  createTime,
  parseTime,
  formatTime,
  addTime,
  subTime,
  shiftTime,
  compareTime,
} from './time';

export type { Syllable } from './syllable';
export {
  createSyllable,
  createUnsetSyllable,
  setSyllableTime,
  unsetSyllableTime,
  shiftSyllableTime,
  isSpaceSyllable,
  isNewlineSyllable,
  isSeparatorSyllable,
} from './syllable';

export type { Word } from './word';
export {
  createWord,
  createUnsetWord,
  createWordWithSyllables,
  createSpaceWord,
  createNewlineWord,
  isSpaceWord,
  isNewlineWord,
  isSeparatorWord,
  wordStartTime,
  wordSyllableCount,
  wordFullySet,
  wordFullyUnset,
} from './word';

export type { BeatRef } from './lyrics';
export { Lyrics } from './lyrics';

export { toJsonWord, fromJsonWord, toJson, fromJson } from './jsonlyrics';

export { toLrc, fromLrc } from './lrclyrics';

export { fromNicoLrc, toNicoLrc } from './nicolyrics';

export {
  isBlank,
  trimWhitespace,
  containsNewline,
  normalizeWhitespace,
  parseTextToWords,
  toTxt,
  fromTxt,
} from './txtlyrics';
