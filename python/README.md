# python/ — Necokara's Python inference backend

Handles **vocal separation (demucs)** and **transcription + word-level
timestamps (stable-ts + faster-whisper)** in Python, replacing the old
onnxruntime-node implementation.

## Why

- **Speed**: faster-whisper runs on CTranslate2 (NVIDIA CUDA), demucs runs on
  PyTorch (CUDA) — faster than onnx/DML and a smaller packaged binary.
- **Accuracy**: stable-ts provides stable word-level timestamps (improved
  DTW alignment, hallucination filtering), fixing the degenerate-timestamp issue.
- **Licensing**: everything is permissive (MIT/BSD); scripts can be committed.

## Layout

```
python/
  .conda-env/          # conda venv (git-ignored, not committed)
  conda-env.bat        # one-shot env setup + deps (with mirrors)
  requirements.txt     # dependency list
  align.py             # transcription + word timestamps (stable-ts)
  separate.py          # vocal separation (demucs)
  README.md            # this file
```

## Environment setup (Windows)

```bat
:: requires miniforge / conda on PATH
cmd /c python\conda-env.bat
```

The script:

1. creates `python\.conda-env` (Python 3.11)
2. installs `requirements.txt` via the Tsinghua PyPI mirror
3. verifies `faster_whisper` and `demucs` import

## Mirrors (committed so the setup is reproducible)

| Purpose            | URL                                        | Env var          |
| ------------------ | ------------------------------------------ | ---------------- |
| pip deps           | `https://pypi.tuna.tsinghua.edu.cn/simple` | `PIP_INDEX_URL`  |
| HuggingFace models | `https://hf-mirror.com`                    | `HF_ENDPOINT`    |
| conda channels     | Tsinghua defaults/conda-forge              | `CONDA_CHANNELS` |

> **`HF_HUB_DISABLE_XET=1` is required**: the hf-mirror proxy does not support
> HuggingFace's Xet storage backend (it returns HTTP 401 otherwise).
> `conda-env.bat` sets it during install; the Electron main process also
> injects it when spawning `align.py` / `separate.py`, so runtime model
> downloads work too.

## Model cache (auto-downloaded at runtime, not committed)

- **faster-whisper models** (base/small/medium...) → `%USERPROFILE%\.cache\huggingface`
- **demucs htdemucs weights** → `%USERPROFILE%\.cache\torch\hub` (or demucs default)
- First run downloads these automatically: the main process spawns the scripts
  with `HF_ENDPOINT=https://hf-mirror.com` and `HF_HUB_DISABLE_XET=1`, so no
  manual model download is needed.

## Script usage (spawned by the main process)

```bat
python\.conda-env\python.exe python\separate.py --input song.mp3 --out-vocals vocal.wav --out-instru instru.wav
python\.conda-env\python.exe python\align.py --vocals vocal.wav --lang ja --lyrics "恋が好きとか もう言えないや" --model base
```

## Licensing

- **demucs**: MIT (code + HTDemucs weights are free to use/redistribute)
- **stable-ts**: MIT
- **faster-whisper / CTranslate2**: MIT
- **PyTorch / torchaudio**: BSD-3
- All permissive; scripts may be committed. Model weights download at runtime,
  are not bundled, and impose no redistribution obligations.
