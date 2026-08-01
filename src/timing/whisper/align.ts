/**
 * whisper/align.ts — map whisper segment timestamps onto the user's furigana
 * (syllable) sequence via character-level edit-distance DP alignment.
 *
 * The furigana sequence is ground truth: whisper only supplies time anchors.
 * Each syllable's reading chars are matched to whisper transcript chars; the
 * first matched char's (interpolated) time becomes the syllable start time.
 * The "segment" granularity for intra-line distribution is the user's own
 * line/word separators, as decided — whisper segments just provide anchors.
 */
import type { Lyrics } from '../../editor/lyrics';
import { isSeparatorWord } from '../../editor/word';
import { setSyllableTime, type Syllable } from '../../editor/syllable';
import { createTime } from '../../editor/time';
import type { WhisperSegment } from './transcribe';

/**
 * Normalize one character for matching: Katakana → Hiragana (1:1 Unicode
 * shift) so katakana loan-words in the whisper transcript can match the
 * hiragana reading in the lyrics (e.g. キャンバス → きゃんばす). Kanji is
 * left untouched — hiragana fragments still give anchors, and the block
 * fallback bridges the rest.
 */
function toHiragana(ch: string): string {
  const c = ch.charCodeAt(0);
  if (c >= 0x30a1 && c <= 0x30f6) {
    return String.fromCharCode(c - 0x60);
  }
  return ch;
}

/**
 * Edit-distance DP with backtracking. Returns aToB[i] = index in `b` aligned
 * with a[i] (match/replace), or -1 when a[i] has no b counterpart.
 * Costs: match 0, replace 2, delete/insert 1.
 */
export function dpAlign(a: string[], b: string[]): Int32Array {
  const n = a.length;
  const m = b.length;
  const cols = m + 1;
  const dp = new Int32Array((n + 1) * cols);
  for (let j = 0; j <= m; j++) dp[j] = j; // row 0
  for (let i = 1; i <= n; i++) dp[i * cols] = i; // col 0
  for (let i = 1; i <= n; i++) {
    const row = i * cols;
    const prevRow = (i - 1) * cols;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 2;
      const v = dp[prevRow + j - 1] + cost;
      const del = dp[prevRow + j] + 1;
      const ins = dp[row + j - 1] + 1;
      dp[row + j] = v < del ? (v < ins ? v : ins) : del < ins ? del : ins;
    }
  }
  const aToB = new Int32Array(n).fill(-1);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const row = i * cols;
    const cost = a[i - 1] === b[j - 1] ? 0 : 2;
    if (dp[row + j] === dp[(i - 1) * cols + j - 1] + cost) {
      aToB[i - 1] = j - 1;
      i--;
      j--;
    } else if (dp[row + j] === dp[(i - 1) * cols + j] + 1) {
      i--; // a[i-1] has no b counterpart
    } else {
      j--; // skip extra b char
    }
  }
  return aToB;
}

/**
 * Align whisper segments to the lyrics and write syllable start times (ms).
 * Segments with no match leave syllables untouched (isSet stays false).
 * @param globalOffsetMs added to every aligned time.
 */
export function alignSegmentsToLyrics(
  segments: WhisperSegment[],
  lyrics: Lyrics,
  globalOffsetMs = 0,
): void {
  if (segments.length === 0) return;

  // whisper transcript char sequence with per-char segment ownership
  const segCharStart: number[] = [];
  const bChars: string[] = [];
  segments.forEach((seg, segIdx) => {
    segCharStart[segIdx] = bChars.length;
    for (const ch of seg.text) bChars.push(toHiragana(ch));
  });

  const timeOfB = (bIdx: number): number => {
    // find owning segment via binary/linear scan (segments are few)
    let segIdx = -1;
    for (let s = 0; s < segments.length; s++) {
      if (bIdx < segCharStart[s] + segments[s].text.length) {
        segIdx = s;
        break;
      }
    }
    if (segIdx < 0) segIdx = segments.length - 1;
    const seg = segments[segIdx];
    const len = segments[segIdx].text.length;
    const frac = (bIdx - segCharStart[segIdx] + 0.5) / len;
    return seg.start + frac * (seg.end - seg.start);
  };

  // lyric char sequence with per-char syllable refs
  const lyricChars: { ch: string; wordIndex: number; sylIndex: number }[] = [];
  lyrics.words.forEach((word, wi) => {
    if (isSeparatorWord(word)) return;
    word.syllables.forEach((syl, si) => {
      for (const ch of syl.reading)
        lyricChars.push({ ch: toHiragana(ch), wordIndex: wi, sylIndex: si });
    });
  });

  const aToB = dpAlign(
    lyricChars.map((c) => c.ch),
    bChars,
  );

  // first matched char time per syllable
  const sylStart = new Map<string, number>();
  for (let i = 0; i < lyricChars.length; i++) {
    const bIdx = aToB[i];
    if (bIdx >= 0) {
      const key = `${lyricChars[i].wordIndex}:${lyricChars[i].sylIndex}`;
      if (!sylStart.has(key)) sylStart.set(key, timeOfB(bIdx));
    }
  }

  // write back
  lyrics.words.forEach((word, wi) => {
    if (isSeparatorWord(word)) return;
    word.syllables.forEach((syl, si) => {
      const t = sylStart.get(`${wi}:${si}`);
      if (t !== undefined && Number.isFinite(t)) {
        const ms = Math.max(0, Math.round(t * 1000) + globalOffsetMs);
        word.syllables[si] = setSyllableTime(syl, createTime(ms)) as Syllable;
      }
    });
  });

  // intra-block linear interpolation: fill gaps so every syllable on a
  // separator-delimited block (space or newline) has a time. Each block is
  // interpolated independently using only its own anchors — never across an
  // in-line space — otherwise syllables after a space get evenly distributed
  // from the previous block's anchors and land too early.
  const blocks: Array<{ start: number; end: number }> = [];
  {
    let start = 0;
    lyrics.words.forEach((word, index) => {
      if (isSeparatorWord(word)) {
        if (index > start) blocks.push({ start, end: index });
        start = index + 1;
      }
    });
    if (start < lyrics.words.length) {
      blocks.push({ start, end: lyrics.words.length });
    }
  }
  // Pass 1: interpolate every block that has at least one anchor. Head/tail
  // use the nearest known time; gaps are filled linearly within the block.
  const blocksInfo: {
    items: { wi: number; si: number; has: boolean; t: number }[];
    known: { i: number; t: number }[];
  }[] = [];
  for (const { start, end } of blocks) {
    const items: { wi: number; si: number; has: boolean; t: number }[] = [];
    for (let wi = start; wi < end; wi++) {
      const word = lyrics.words[wi];
      if (isSeparatorWord(word)) continue;
      word.syllables.forEach((syl, si) => {
        const t = sylStart.get(`${wi}:${si}`);
        items.push({
          wi,
          si,
          has: t !== undefined && Number.isFinite(t),
          t: t ?? 0,
        });
      });
    }
    const known = items
      .map((it, i) => ({ i, t: it.t }))
      .filter((_, i) => items[i].has);
    blocksInfo.push({ items, known });
    if (known.length === 0) continue;
    // fill head/tail with nearest known time, gaps linearly
    for (let i = 0; i < items.length; i++) {
      if (items[i].has) continue;
      let t: number;
      const prev = known.filter((k) => k.i < i).pop();
      const next = known.find((k) => k.i > i);
      if (prev && next) {
        const frac = (i - prev.i) / (next.i - prev.i);
        t = prev.t + frac * (next.t - prev.t);
      } else {
        t = prev ? prev.t : next ? next.t : 0;
      }
      const ms = Math.max(0, Math.round(t * 1000) + globalOffsetMs);
      const w = lyrics.words[items[i].wi];
      w.syllables[items[i].si] = setSyllableTime(
        w.syllables[items[i].si],
        createTime(ms),
      ) as Syllable;
    }
  }

  // Pass 2: blocks with no anchor at all still get timed, bridged between the
  // nearest anchored blocks, so no line is ever left without a time (previously
  // `continue` skipped them → the line was simply left un-timed).
  for (let b = 0; b < blocksInfo.length; b++) {
    const { items, known } = blocksInfo[b];
    if (known.length > 0 || items.length === 0) continue;
    let prevT: number | null = null;
    for (let i = b - 1; i >= 0; i--) {
      const k = blocksInfo[i].known;
      if (k.length > 0) {
        prevT = k[k.length - 1].t;
        break;
      }
    }
    let nextT: number | null = null;
    for (let i = b + 1; i < blocksInfo.length; i++) {
      const k = blocksInfo[i].known;
      if (k.length > 0) {
        nextT = k[0].t;
        break;
      }
    }
    const t0 = prevT ?? nextT ?? 0;
    const t1 = nextT ?? prevT ?? t0;
    for (let i = 0; i < items.length; i++) {
      const frac = items.length <= 1 ? 0 : i / (items.length - 1);
      const t = t0 + frac * (t1 - t0);
      const ms = Math.max(0, Math.round(t * 1000) + globalOffsetMs);
      const w = lyrics.words[items[i].wi];
      w.syllables[items[i].si] = setSyllableTime(
        w.syllables[items[i].si],
        createTime(ms),
      ) as Syllable;
    }
  }
}
