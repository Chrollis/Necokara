import { createTime } from './time';

export interface Syllable {
  reading: string;
  time: { msec: number };
  isSet: boolean;
}

export function createSyllable(
  reading: string,
  time: { msec: number },
): Syllable {
  return { reading, time, isSet: true };
}

export function createUnsetSyllable(reading: string): Syllable {
  return { reading, time: createTime(0), isSet: false };
}

export function setSyllableTime(
  syl: Syllable,
  time: { msec: number },
): Syllable {
  return { ...syl, time, isSet: true };
}

export function unsetSyllableTime(syl: Syllable): Syllable {
  return { ...syl, time: createTime(0), isSet: false };
}

export function shiftSyllableTime(
  syl: Syllable,
  offset: { msec: number },
): Syllable {
  return { ...syl, time: { msec: syl.time.msec + offset.msec } };
}

export function isSpaceSyllable(syl: Syllable): boolean {
  return syl.reading === ' ';
}

export function isNewlineSyllable(syl: Syllable): boolean {
  return syl.reading === '\n';
}

export function isSeparatorSyllable(syl: Syllable): boolean {
  return isSpaceSyllable(syl) || isNewlineSyllable(syl);
}

/** CJK / latin punctuation characters (no musical duration). `ー` (choonpu,
 * extends the previous kana) is ordinary text (it has duration); `～`/`~` and
 * `・` (nakaguro) are soundless decorations → punctuation. */
const PUNCTUATION_CHARS = '「」『』（）、。！？…・～~,.;:!?"\'';

/** Whether a single character is punctuation. */
export function isPunctuationChar(ch: string): boolean {
  return PUNCTUATION_CHARS.includes(ch);
}
