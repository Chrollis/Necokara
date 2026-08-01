import type { Lyrics } from '../editor/lyrics';
import { isSeparatorWord } from '../editor/word';
import { setSyllableTime } from '../editor/syllable';
import type { BpmSegment } from './types';

export function getBpmAtTime(
  bpmSegments: BpmSegment[],
  timeMs: number,
): number | null {
  if (bpmSegments.length === 0) return null;

  let bpm: number | null = null;
  let latestStart = -1;

  bpmSegments.forEach((seg) => {
    if (seg.start <= timeMs && seg.start >= latestStart) {
      latestStart = seg.start;
      bpm = seg.bpm > 0 ? seg.bpm : null;
    }
  });

  return bpm;
}

export function snapToBpmGrid(
  timeMs: number,
  bpmSegments: BpmSegment[],
  gridDenominator: number = 16,
): number {
  // Find the applicable segment (latest start ≤ timeMs)
  let best: BpmSegment | null = null;
  for (const s of bpmSegments) {
    if (s.start <= timeMs && (!best || s.start >= best.start)) {
      best = s;
    }
  }

  if (!best || best.bpm <= 0) return timeMs;
  const seg = best;

  const gridInterval = 60000 / seg.bpm / gridDenominator;
  if (gridInterval <= 0 || !isFinite(gridInterval)) return timeMs;

  // Snap relative to the segment's start time, matching waveform grid line alignment
  const offset = (timeMs - seg.start) / gridInterval;
  const snapped = seg.start + Math.round(offset) * gridInterval;
  return Math.max(0, snapped);
}

export function dragBoundaryClampedTime(
  lyrics: Lyrics,
  beatIndex: number,
  targetTimeMs: number,
  bpmSegments: BpmSegment[],
): number | null {
  const beatRefs = lyrics.getBeatRefs();
  if (beatIndex < 0 || beatIndex >= beatRefs.length) return null;

  const ref = beatRefs[beatIndex];
  const word = lyrics.words[ref.wordIndex];
  if (isSeparatorWord(word)) return null;

  const syl = word.syllables[ref.sylIndex];
  if (!syl.isSet) return null;

  let minTime = 0;
  let maxTime = Number.MAX_SAFE_INTEGER;

  for (let i = beatIndex - 1; i >= 0; i -= 1) {
    const prevRef = beatRefs[i];
    const prevSyl = lyrics.words[prevRef.wordIndex].syllables[prevRef.sylIndex];
    if (prevSyl.isSet) {
      minTime = prevSyl.time.msec;
      break;
    }
  }

  for (let i = beatIndex + 1; i < beatRefs.length; i += 1) {
    const nextRef = beatRefs[i];
    const nextSyl = lyrics.words[nextRef.wordIndex].syllables[nextRef.sylIndex];
    if (nextSyl.isSet) {
      maxTime = nextSyl.time.msec;
      break;
    }
  }

  const snapped = snapToBpmGrid(targetTimeMs, bpmSegments);
  return Math.max(minTime + 1, Math.min(maxTime - 1, snapped));
}
