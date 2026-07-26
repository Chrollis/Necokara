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

export function setSyllableTime(syl: Syllable, time: { msec: number }): void {
  syl.time = time;
  syl.isSet = true;
}

export function unsetSyllableTime(syl: Syllable): void {
  syl.time = createTime(0);
  syl.isSet = false;
}

export function shiftSyllableTime(
  syl: Syllable,
  offset: { msec: number },
): void {
  syl.time = { msec: syl.time.msec + offset.msec };
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

export function syllableEquals(a: Syllable, b: Syllable): boolean {
  return (
    a.reading === b.reading &&
    a.time.msec === b.time.msec &&
    a.isSet === b.isSet
  );
}
