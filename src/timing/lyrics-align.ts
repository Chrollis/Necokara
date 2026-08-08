/**
 * lyrics-align.ts — map stable-ts char-level times onto the user's syllables.
 *
 * stable-ts ``model.align()`` force-aligns the full lyrics (readingPrompt)
 * onto the audio and returns per-character start times (see python/align.py).
 * We rebuild the same char stream and, for each syllable, take the time of its
 * first reading char. Separators/punctuation are skipped here — their times
 * are inferred separately (inferSeparatorTimes / scanAllPunctuations). Times
 * are clamped to stay monotonic so misalignment can't reorder beats.
 */
import type { Lyrics } from '../editor/lyrics';
import { isSeparatorWord, isPunctuationWord } from '../editor/word';
import { setSyllableTime, type Syllable } from '../editor/syllable';
import { createTime } from '../editor/time';

/**
 * Write syllable times from stable-ts per-lyric-char timings.
 *
 * `charTimesMap` keys are offsets into `lyrics.readingPrompt()` (separators
 * included, exactly matching the string that was force-aligned). Each
 * syllable takes the time of its first reading char; times are clamped
 * monotonic in lyric order so misaligned chars can't reorder beats.
 * Unmatched syllables stay unset.
 * @param globalOffsetMs added to every aligned time.
 */
export function applyCharTimesMap(
  lyrics: Lyrics,
  charTimesMap: Record<string, number>,
  globalOffsetMs = 0,
): void {
  // owner[charIndex] = { wi, si } for sung syllables, null for separators /
  // punctuation — exactly parallel to lyrics.readingPrompt().
  const owner: Array<{ wi: number; si: number } | null> = [];
  lyrics.words.forEach((word, wi) => {
    if (isSeparatorWord(word) || isPunctuationWord(word)) {
      for (const _ of word.reading) owner.push(null);
      return;
    }
    word.syllables.forEach((syl, si) => {
      for (const _ of syl.reading) owner.push({ wi, si });
    });
  });

  // Collect each syllable's time from its first reading char (first wins).
  const sylTime = new Map<string, number>();
  for (let ci = 0; ci < owner.length; ci++) {
    const t = charTimesMap[String(ci)];
    if (t === undefined || !Number.isFinite(t)) continue;
    const o = owner[ci];
    if (!o) continue;
    const key = `${o.wi}:${o.si}`;
    if (!sylTime.has(key)) sylTime.set(key, t);
  }

  // Write back, clamping to strictly monotonic in lyric order.
  let lastMs = -Infinity;
  lyrics.words.forEach((word, wi) => {
    if (isSeparatorWord(word)) return;
    word.syllables.forEach((syl, si) => {
      const t = sylTime.get(`${wi}:${si}`);
      if (t === undefined) return;
      let ms = Math.max(0, Math.round(t * 1000) + globalOffsetMs);
      if (ms < lastMs) ms = Math.round(lastMs + 1);
      lastMs = ms;
      word.syllables[si] = setSyllableTime(
        word.syllables[si],
        createTime(ms),
      ) as Syllable;
    });
  });
}
