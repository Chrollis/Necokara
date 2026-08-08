@echo off
REM python/conda-env.bat — one-shot setup of Necokara's Python inference env
REM
REM Creates/repairs python/.conda-env (Python 3.11) and installs inference deps.
REM Includes CN mirror presets (conda/pip). Idempotent — safe to re-run.
REM
REM Usage:  cmd /c python\conda-env.bat
setlocal

cd /d "%~dp0.."

REM ---------- Mirrors (CN acceleration; comment out if not needed) ----------
REM conda channels (Tsinghua)
set CONDA_CHANNELS=defaults conda-forge
REM pip index (Tsinghua PyPI)
set PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
REM HuggingFace model mirror
set HF_ENDPOINT=https://hf-mirror.com
REM Disable HF Xet backend (hf-mirror does not support it -> 401 errors)
set HF_HUB_DISABLE_XET=1

echo [1/3] Creating conda env python\.conda-env (Python 3.11) ...
if not exist python\.conda-env\python.exe (
  conda create -p python\.conda-env python=3.11 -y || goto :fail
) else (
  echo     Already exists, skipping
)

echo [2/3] Installing pip deps (stable-ts + faster-whisper + demucs) ...
python\.conda-env\python.exe -m pip install --upgrade pip
python\.conda-env\python.exe -m pip install -r python\requirements.txt || goto :fail

echo [3/3] Verifying install ...
python\.conda-env\python.exe -c "import faster_whisper, demucs; print('OK: faster_whisper', faster_whisper.__version__)" || goto :fail

echo.
echo Environment ready: python\.conda-env
echo HF model cache: %USERPROFILE%\.cache\huggingface  (HF_ENDPOINT=%HF_ENDPOINT%)
goto :eof

:fail
echo.
echo Setup FAILED — check network / mirror settings / conda in PATH.
exit /b 1
