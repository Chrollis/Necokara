/**
 * whisper.ts — Whisper alignment via the Python backend (stable-ts).
 *
 * Spawns python/align.py with the user-configured Python interpreter and
 * ffmpeg executable. Both are validated before the process is spawned so a
 * missing/broken config fails fast with a clear Chinese message instead of a
 * cryptic Python error.
 */
import { spawn } from 'node:child_process';
import {
  getResourceConfig,
  pythonScriptPath,
  validateFfmpeg,
  validatePython,
} from './resources';
import { whisperLanguageCode } from '../shared/whisper-languages';
import type { WhisperSegment } from '../shared/whisper-types';

export interface AlignResult {
  segments: WhisperSegment[];
  /** per-lyric-char absolute times (seconds) keyed by offset into the
   * original lyrics text (readingPrompt) that was force-aligned */
  charTimesMap?: Record<string, number>;
}

interface AlignOutput {
  ok: boolean;
  error?: string;
  charTimes?: Record<string, number>;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
  }>;
}

/**
 * Force-align separated vocals to the user's lyrics via the Python backend:
 * stable-ts aligns the full lyrics (syllable.reading concat) onto the audio
 * and we return per-char times.
 * @param vocalsPath path to the separated vocals wav
 * @param languageToken whisper language token id (e.g. <|ja|>)
 * @param clean noise-gate settings for instrumental residue
 * @param lyricsText full lyrics (readingPrompt) to force-align onto the audio
 */
export async function alignVocal(
  vocalsPath: string,
  languageToken: number,
  clean?: { enabled: boolean; threshold: number },
  lyricsText?: string,
  onProgress?: (p: number) => void,
): Promise<AlignResult | null> {
  const config = getResourceConfig();
  if (!config.ffmpegPath) {
    throw new Error('未配置 ffmpeg 路径，请先在「资源配置」中配置');
  }
  if (!config.pythonPath) {
    throw new Error('未配置 Python 解释器路径，请先在「资源配置」中配置');
  }
  // align.py now requires --lyrics; guard here so a missing lyric text fails
  // fast with a clear message instead of a python usage error.
  if (!lyricsText) {
    throw new Error('缺少歌词文本，无法进行对齐');
  }
  const ffmpegCheck = await validateFfmpeg(config.ffmpegPath);
  if (!ffmpegCheck.ok) {
    throw new Error(`ffmpeg 不可用：${ffmpegCheck.error}`);
  }
  const pythonCheck = await validatePython(config.pythonPath);
  if (!pythonCheck.ok) {
    throw new Error(`Python 不可用：${pythonCheck.error}`);
  }

  const args = [
    pythonScriptPath('align.py'),
    '--vocals',
    vocalsPath,
    '--lang',
    whisperLanguageCode(languageToken),
    '--model',
    'base',
    '--ffmpeg',
    config.ffmpegPath,
  ];
  args.push('--lyrics', lyricsText);
  if (clean?.enabled && clean.threshold > 0) {
    args.push('--threshold', String(clean.threshold));
  }

  return new Promise((resolve, reject) => {
    const child = spawn(config.pythonPath, args, {
      env: {
        ...process.env,
        HF_HUB_DISABLE_XET: '1',
        PYTHONIOENCODING: 'utf-8',
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      const text = d.toString('utf8');
      stderr += text;
      // python scripts report `PROGRESS <0..1>` on stderr; forward it
      for (const line of text.split('\n')) {
        const m = /^PROGRESS\s+([0-9.]+)/.exec(line.trim());
        if (m) onProgress?.(Math.min(1, Math.max(0, Number(m[1]))));
      }
    });
    child.on('error', (err) => {
      reject(err);
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Python 对齐失败（exit ${code}）`));
        return;
      }
      try {
        const payload = JSON.parse(stdout) as AlignOutput;
        if (!payload.ok) {
          reject(new Error(payload.error ?? 'Python 对齐失败'));
          return;
        }
        const segments: WhisperSegment[] = (payload.segments ?? []).map(
          (s) => ({
            start: s.start,
            end: s.end,
            text: s.text,
          }),
        );
        resolve({ segments, charTimesMap: payload.charTimes });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}
