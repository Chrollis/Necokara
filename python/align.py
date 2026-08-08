#!/usr/bin/env python
"""align.py — Force-align the user's lyrics to a vocals wav (stable-ts).

The audio is decoded with the user-configured ffmpeg executable (full path)
instead of relying on `ffmpeg` being on PATH, so the exact binary the user
chose in the resource config is used. The full lyrics text (syllable.reading
concatenation) is force-aligned onto the audio with stable-ts ``model.align()``.

stdout (utf-8) carries ONLY the JSON result; all third-party / progress
logging goes to stderr via a stdout redirect.

Usage:
    python align.py --vocals <wav> --lang ja --model base --ffmpeg <path> --lyrics <text>

Success JSON:
    {"ok": true, "charTimes": {"0": 1.23, "1": 1.26, ...},
     "segments": [{"start": 0.0, "end": 1.2, "text": "..."}]}

``charTimes`` maps each character index of the *original* ``--lyrics`` text
(i.e. ``lyrics.readingPrompt()``) to its aligned start time in seconds. This
is the ground truth the renderer maps back onto its syllables.

Failure JSON (also exit code 1):
    {"ok": false, "error": "..."}
"""
from __future__ import annotations

import argparse
import contextlib
import json
import os
import re
import subprocess
import sys

import numpy as np

FFMPEG_SAMPLE_RATE = 16000


def add_nvidia_dll_dirs() -> None:
    """Make nvidia runtime DLLs (cuBLAS/cuDNN) loadable for faster-whisper CUDA.

    These packages are installed via pip (nvidia-cublas-cu12 / nvidia-cudnn-cu12)
    but their bin dirs are not on PATH by default; faster-whisper (CTranslate2)
    needs them to use the GPU. CTranslate2 resolves the DLLs through PATH, so we
    prepend the dirs there as well as via add_dll_directory.
    """
    base = os.path.join(sys.prefix, "Lib", "site-packages", "nvidia")
    dirs = []
    for name in ("cublas", "cudnn"):
        dll_dir = os.path.join(base, name, "bin")
        if os.path.isdir(dll_dir):
            dirs.append(dll_dir)
            try:
                os.add_dll_directory(dll_dir)
            except AttributeError:  # non-Windows: no add_dll_directory
                pass
    if dirs:
        os.environ["PATH"] = (
            os.pathsep.join(dirs) + os.pathsep + os.environ.get("PATH", "")
        )


def decode_audio(
    ffmpeg_path: str, audio_path: str, sr: int = FFMPEG_SAMPLE_RATE
) -> np.ndarray:
    """Decode any audio to 16 kHz mono float32 PCM using the exact ffmpeg binary."""
    cmd = [
        ffmpeg_path,
        "-nostdin",
        "-loglevel",
        "error",
        "-i",
        audio_path,
        "-f",
        "f32le",
        "-ac",
        "1",
        "-ar",
        str(sr),
        "-",
    ]
    proc = subprocess.run(cmd, capture_output=True, check=True)
    samples = np.frombuffer(proc.stdout, dtype=np.float32).copy()
    if samples.size == 0:
        raise RuntimeError(f"ffmpeg decoded no audio from {audio_path}")
    return samples


def clean_vocal(audio, threshold, sr=FFMPEG_SAMPLE_RATE):
    """Noise gate for separated vocals (ported from the old onnx cleanVocal):
    attenuate low-energy frames (instrumental residue) using a global
    frame-RMS percentile threshold, with attack/release smoothing. Returns the
    track unchanged when nothing falls below the gate so real vocals are never
    damaged.
    """
    if threshold <= 0 or len(audio) == 0:
        return audio
    frame = int(0.032 * sr)  # 32ms
    hop = int(0.016 * sr)  # 16ms
    n_frames = max(1, (len(audio) - frame) // hop + 1)
    rms = np.empty(n_frames, dtype=np.float64)
    for f in range(n_frames):
        seg = audio[f * hop : f * hop + frame]
        if len(seg) == 0:
            rms[f] = 0.0
        else:
            rms[f] = np.sqrt(np.mean(np.square(seg, dtype=np.float64)))
    pct = min(max(threshold, 0.0), 40.0)
    thr = float(np.percentile(rms, pct))
    quiet = int(np.sum(rms <= thr))
    if quiet == 0:
        return audio
    with np.errstate(divide="ignore", invalid="ignore"):
        r = rms / max(thr, 1e-9)
        gate = np.where(r <= 1, 0.0, np.minimum(1.0, (r - 1) / 0.5))
    attack = 0.6
    release = 0.08
    prev = 0.0
    out = audio.copy()
    for f in range(n_frames):
        g = gate[f]
        if g > prev:
            prev = prev + (g - prev) * attack
        else:
            prev = prev + (g - prev) * release
        off = f * hop
        seg = out[off : off + frame]
        if len(seg):
            seg *= prev
    return out


def standardize_text(text: str) -> str:
    """Mirror stable-ts ``_standardize_text`` for plain text:
    collapse every whitespace run to a single space and ensure a leading
    space. This is exactly the string the returned words concatenate to, so
    we can walk it to map each word back to a character index."""
    text = re.sub(r"\s", " ", text)
    if not text.startswith(" "):
        text = " " + text
    return text


def align(args: argparse.Namespace) -> dict:
    """Force-align the full lyrics text onto the audio (stable-ts model.align).

    Returns ``charTimes`` keyed by index into the *original* ``--lyrics`` text
    (i.e. ``lyrics.readingPrompt()``): charTimes[i] is the aligned start time
    (seconds) of readingPrompt char i. Non-whitespace / non-punctuation chars
    are the ground truth; the renderer maps each of its syllables to its first
    reading char. Newlines/spaces/punctuation get times too but are ignored by
    the renderer (it infers them itself)."""
    if not os.path.isfile(args.ffmpeg):
        raise RuntimeError(f"ffmpeg not found: {args.ffmpeg}")

    sys.stderr.write(f"[align] decoding {args.vocals} ...\n")
    audio = decode_audio(args.ffmpeg, args.vocals)
    if args.threshold and args.threshold > 0:
        sys.stderr.write(f"[align] noise gate threshold {args.threshold}\n")
        audio = clean_vocal(audio, args.threshold)
    sys.stderr.write(
        f"[align] {audio.size / FFMPEG_SAMPLE_RATE:.1f}s audio, "
        f"loading model '{args.model}' ...\n"
    )

    import stable_whisper

    model = stable_whisper.load_faster_whisper(
        args.model, device="auto", compute_type="auto"
    )

    lyrics = args.lyrics
    std_text = standardize_text(lyrics)

    def on_progress(decoded_seconds, total_seconds):
        p = (decoded_seconds / total_seconds) if total_seconds else 0.0
        sys.stderr.write(f"PROGRESS {p:.3f}\n")
        sys.stderr.flush()

    sys.stderr.write(f"[align] aligning {len(lyrics)} chars of lyrics ...\n")
    with contextlib.redirect_stdout(sys.stderr):
        result = model.align(
            audio,
            lyrics,
            language=args.lang,
            # stable-ts: verbose=None shows nothing (False would still render tqdm)
            verbose=None,
            progress_callback=on_progress,
        )
    if result is None:
        raise RuntimeError("stable-ts align returned no result")

    # ── build per-char times ────────────────────────────────────────────────
    # Words concatenate to std_text (verified round-trip). Walk them,
    # accumulating character offsets; within a word interpolate linearly so
    # every char of a multi-char token gets its own time. std char 0 is the
    # synthetic leading space → skip. original lyrics index = std index - 1.
    char_times = {}
    std_offset = 0
    for seg in result.segments:
        for w in seg.words or []:
            n = len(w.word)
            if n == 0:
                continue
            for j in range(n):
                std_idx = std_offset + j
                if std_idx == 0:
                    continue
                frac = j / n if n > 1 else 0.0
                t = round(w.start + (w.end - w.start) * frac, 3)
                key = str(std_idx - 1)
                # first char of a syllable wins (matches applyCharTimesMap)
                if key not in char_times:
                    char_times[key] = t
            std_offset += n

    segments = [
        {
            "start": round(seg.start, 3),
            "end": round(seg.end, 3),
            "text": (seg.text or "").strip(),
        }
        for seg in result.segments
    ]
    sys.stderr.write(
        f"[align] done: {len(segments)} segments, {len(char_times)} char times\n"
    )
    return {"ok": True, "charTimes": char_times, "segments": segments}


def main() -> int:
    # faster-whisper renders a tqdm progress bar on stderr which uses `\r`
    # and would corrupt our `PROGRESS` lines; disable it globally.
    os.environ.setdefault("TQDM_DISABLE", "1")

    parser = argparse.ArgumentParser(description="stable-ts lyrics alignment")
    parser.add_argument("--vocals", required=True, help="path to vocals wav")
    parser.add_argument("--lang", required=True, help="whisper language code, e.g. ja")
    parser.add_argument("--model", default="base", help="whisper model size")
    parser.add_argument(
        "--ffmpeg", required=True, help="full path to ffmpeg executable"
    )
    parser.add_argument(
        "--lyrics",
        required=True,
        help="full lyrics text (syllable.reading concat) to force-align",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=0.0,
        help="noise-gate threshold (frame-energy percentile 0-40); 0 = off",
    )
    args = parser.parse_args()

    add_nvidia_dll_dirs()
    try:
        payload = align(args)
    except Exception as err:  # noqa: BLE001 — report every failure to the caller
        payload = {"ok": False, "error": f"{type(err).__name__}: {err}"}

    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    return 0 if payload.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
