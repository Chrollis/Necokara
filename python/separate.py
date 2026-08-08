#!/usr/bin/env python
"""separate.py — Vocal separation via demucs (HTDemucs).

Separates the input audio into a vocals stem and an optional instrumental stem
(drums + bass + other summed). The demucs Python API is used; results are
saved as WAVs at the caller-provided absolute paths.

stdout (utf-8) carries ONLY the JSON result; logs go to stderr.

Usage:
    python separate.py --input <audio> --out-vocals <wav> [--out-instru <wav>]

Success JSON:
    {"ok": true, "vocals": "<abs path>", "instru": "<abs path or null>"}

Failure JSON (also exit code 1):
    {"ok": false, "error": "..."}
"""
from __future__ import annotations

import argparse
import contextlib
import json
import os
import sys
from pathlib import Path

import torch


def separate(args: argparse.Namespace) -> dict:
    if not os.path.isfile(args.input):
        raise RuntimeError(f"input audio not found: {args.input}")

    sys.stderr.write("[separate] loading demucs (htdemucs) ...\n")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    sys.stderr.write(f"[separate] device: {device}\n")

    from demucs.api import Separator, save_audio

    def on_chunk(cb: dict):
        # demucs calls the callback with {audio_length, segment_offset, state}
        # at the start AND end of each chunk; report on chunk-end only.
        if cb.get("state") != "end":
            return
        total = int(cb.get("audio_length") or 0)
        offset = int(cb.get("segment_offset") or 0)
        if total > 0:
            p = min(1.0, offset / total)
            sys.stderr.write(f"PROGRESS {p:.3f}\n")
            sys.stderr.flush()

    separator = Separator(
        model="htdemucs", device=device, progress=False, callback=on_chunk
    )
    samplerate = separator.samplerate

    sys.stderr.write(f"[separate] separating {args.input} ...\n")
    with contextlib.redirect_stdout(sys.stderr):
        _, separated = separator.separate_audio_file(Path(args.input))
    sys.stderr.write("PROGRESS 1.000\n")
    sys.stderr.flush()

    if "vocals" not in separated:
        raise RuntimeError("demucs did not produce a vocals stem")

    vocals_path = os.path.abspath(args.out_vocals)
    os.makedirs(os.path.dirname(vocals_path) or ".", exist_ok=True)
    save_audio(separated["vocals"], vocals_path, samplerate=samplerate)
    sys.stderr.write(f"[separate] saved vocals -> {vocals_path}\n")

    instru = None
    if args.out_instru:
        instru_path = os.path.abspath(args.out_instru)
        no_vocals = None
        if "no_vocals" in separated:
            no_vocals = separated["no_vocals"]
        else:
            stems = [
                separated[k] for k in ("drums", "bass", "other") if k in separated
            ]
            if stems:
                no_vocals = sum(stems, start=torch.zeros_like(separated["vocals"]))
        if no_vocals is not None:
            os.makedirs(os.path.dirname(instru_path) or ".", exist_ok=True)
            save_audio(no_vocals, instru_path, samplerate=samplerate)
            instru = instru_path
            sys.stderr.write(f"[separate] saved instru -> {instru_path}\n")
        else:
            sys.stderr.write("[separate] warning: could not build instrumental stem\n")

    return {"ok": True, "vocals": vocals_path, "instru": instru}


def main() -> int:
    parser = argparse.ArgumentParser(description="demucs vocal separation")
    parser.add_argument("--input", required=True, help="path to source audio")
    parser.add_argument("--out-vocals", required=True, help="output vocals wav path")
    parser.add_argument(
        "--out-instru", default=None, help="optional instrumental wav path"
    )
    args = parser.parse_args()

    try:
        payload = separate(args)
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
