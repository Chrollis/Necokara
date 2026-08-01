/**
 * clean.ts — light vocal cleanup to help Whisper ignore instrumental
 * residue in separated vocals (which otherwise gets transcribed as early
 * speech and shifts timings early).
 *
 * Strategy: adaptive noise gate based on frame-RMS percentiles.
 * - Does NOT assume silence at the start — works even when singing starts
 *   immediately (frames are ranked globally, not from a leading window).
 * - Frames whose energy falls below a low percentile are treated as
 *   instrumental/ambience residue and attenuated with attack/release
 *   smoothing to avoid clicks.
 * - If almost no frame is quiet (continuous loud signal), the audio is
 *   returned unchanged so real vocals are never damaged.
 */

import type { WhisperSegment } from './transcribe';

const SAMPLE_RATE = 16000;
const FRAME_MS = 32;
const HOP_MS = 16;

export interface CleanVocalOptions {
  enabled: boolean;
  /** frame-energy percentile (0-40) used as the noise-gate threshold. */
  threshold: number;
}

/**
 * Attenuate low-energy (residue) frames of a 16k mono vocal track.
 * @param audio 16k mono float32
 * @param opts gate options
 */
export function cleanVocal(
  audio: Float32Array,
  opts: CleanVocalOptions,
): Float32Array {
  if (!opts.enabled || audio.length === 0) return audio;

  const frame = Math.round((FRAME_MS / 1000) * SAMPLE_RATE);
  const hop = Math.round((HOP_MS / 1000) * SAMPLE_RATE);
  const nFrames = Math.max(1, Math.floor((audio.length - frame) / hop) + 1);

  // Per-frame RMS energy.
  const rms = new Float32Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    const off = f * hop;
    const len = Math.min(frame, audio.length - off);
    let s = 0;
    for (let i = 0; i < len; i++) {
      const v = audio[off + i];
      s += v * v;
    }
    rms[f] = Math.sqrt(s / len);
  }

  // Percentile threshold over the whole track.
  const sorted = Array.from(rms).sort((a, b) => a - b);
  const pct = Math.min(Math.max(opts.threshold, 0), 40);
  const idx = Math.min(
    sorted.length - 1,
    Math.floor((pct / 100) * sorted.length),
  );
  const thr = sorted[idx];

  // If nothing is actually below the gate (continuous loud signal) keep
  // the track untouched — never risk damaging real vocals.
  let quiet = 0;
  for (let f = 0; f < nFrames; f++) if (rms[f] <= thr) quiet++;
  if (quiet === 0) return audio;

  // Gate gain per frame with a soft ramp around the threshold.
  const gate = new Float32Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    const r = rms[f] / Math.max(thr, 1e-9);
    gate[f] = r <= 1 ? 0 : Math.min(1, (r - 1) / 0.5);
  }

  // Attack/release smoothing to avoid clicks and keep consonant attacks.
  let prev = 0;
  const attack = 0.6; // how fast the gate opens onto a vocal
  const release = 0.08; // how fast it closes after a vocal
  for (let f = 0; f < nFrames; f++) {
    if (gate[f] > prev) prev = prev + (gate[f] - prev) * attack;
    else prev = prev + (gate[f] - prev) * release;
    gate[f] = prev;
  }

  const out = new Float32Array(audio);
  for (let f = 0; f < nFrames; f++) {
    const off = f * hop;
    const len = Math.min(frame, audio.length - off);
    for (let i = 0; i < len; i++) out[off + i] *= gate[f];
  }
  return out;
}

/**
 * Whisper tends to start the first segment of a window at 0.00 even when
 * there is leading silence (instrumental residue). This trims each segment's
 * start forward to the first frame with real energy, using the (gated) audio
 * as the ground truth. Safe: only moves starts by at most MAX_TRIM_S and
 * never past the segment end, and only when the segment head is actually
 * silent in the audio.
 */
const MAX_TRIM_S = 1.5;

/** Frame RMS helper shared with cleanVocal. */
function frameRms(
  audio: Float32Array,
  frame: number,
  hop: number,
): Float32Array {
  const nFrames = Math.max(1, Math.floor((audio.length - frame) / hop) + 1);
  const rms = new Float32Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    const off = f * hop;
    const len = Math.min(frame, audio.length - off);
    let s = 0;
    for (let i = 0; i < len; i++) {
      const v = audio[off + i];
      s += v * v;
    }
    rms[f] = Math.sqrt(s / len);
  }
  return rms;
}

/**
 * Trim leading silence off each segment using the cleaned audio.
 * @param audio 16k mono (ideally after cleanVocal) used to detect real energy
 */
export function trimSegmentSilence(
  segments: WhisperSegment[],
  audio: Float32Array,
): WhisperSegment[] {
  const frame = Math.round((FRAME_MS / 1000) * SAMPLE_RATE);
  const hop = Math.round((HOP_MS / 1000) * SAMPLE_RATE);
  const hopSec = hop / SAMPLE_RATE;
  const rms = frameRms(audio, frame, hop);
  const nFrames = rms.length;
  if (nFrames === 0) return segments;

  // reference energy: median RMS of the track, floored by a small absolute
  const sorted = Array.from(rms).sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const energyThr = Math.max(1e-4, med * 0.08);
  const maxTrimFrames = Math.floor(MAX_TRIM_S / hopSec);

  return segments.map((s) => {
    const frameStart = Math.floor(s.start / hopSec);
    const frameEnd = Math.min(nFrames, frameStart + maxTrimFrames);
    let newStart = s.start;
    for (let f = frameStart; f < frameEnd; f++) {
      if (rms[f] >= energyThr) {
        newStart = f * hopSec;
        break;
      }
    }
    if (newStart >= s.end) newStart = s.start;
    return newStart === s.start ? s : { ...s, start: newStart };
  });
}
