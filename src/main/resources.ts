/**
 * resources.ts — External dependency configuration (main process).
 *
 * Manages user-provided paths for models / ffmpeg, persisted to
 * `userData/settings.json`. The app does NOT bundle or download models;
 * it only stores the paths the user configures and validates them.
 */
import { app, dialog, ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import IPC, {
  FfmpegValidation,
  PythonValidation,
  ResourceConfig,
} from '../shared/ipc';
import {
  WHISPER_LANGUAGES,
  whisperLanguageId,
} from '../shared/whisper-languages';

const DEFAULT_CONFIG: ResourceConfig = { ffmpegPath: '', pythonPath: '' };

function configFilePath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readConfig(): ResourceConfig {
  try {
    const raw = fs.readFileSync(configFilePath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<ResourceConfig>;
    return {
      ffmpegPath:
        typeof parsed.ffmpegPath === 'string' ? parsed.ffmpegPath : '',
      pythonPath:
        typeof parsed.pythonPath === 'string' ? parsed.pythonPath : '',
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function writeConfig(config: ResourceConfig): void {
  try {
    fs.mkdirSync(path.dirname(configFilePath()), { recursive: true });
    fs.writeFileSync(
      configFilePath(),
      JSON.stringify(config, null, 2),
      'utf-8',
    );
  } catch (err) {
    console.error('[resources] failed to save config', err);
  }
}

/** 读取外部依赖配置（供主进程其他模块使用） */
export function getResourceConfig(): ResourceConfig {
  return readConfig();
}

/** Absolute path to a python backend script (python/*.py) in this app. */
export function pythonScriptPath(name: string): string {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'python')
    : path.join(app.getAppPath(), 'python');
  return path.join(base, name);
}

function spawnErrorMessage(err: {
  code?: string | number | null;
  message?: string;
}): string {
  const code = typeof err.code === 'string' ? err.code : undefined;
  if (code === 'EFTYPE' || code === 'ENOEXEC') {
    return '所选文件不是可执行程序';
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return '没有执行权限';
  }
  if (code === 'ENOENT') {
    return '文件不存在';
  }
  return `无法执行：${err.message}`;
}

export function validateFfmpeg(ffmpegPath: string): Promise<FfmpegValidation> {
  return new Promise((resolve) => {
    if (!ffmpegPath) {
      resolve({ ok: false, error: '未配置 ffmpeg 路径' });
      return;
    }
    if (!fs.existsSync(ffmpegPath)) {
      resolve({ ok: false, error: '文件不存在' });
      return;
    }
    let stat;
    try {
      stat = fs.statSync(ffmpegPath);
    } catch {
      resolve({ ok: false, error: '无法访问该路径' });
      return;
    }
    if (stat.isDirectory()) {
      resolve({
        ok: false,
        error: '所选路径是文件夹，请选择 ffmpeg 可执行文件',
      });
      return;
    }
    try {
      execFile(
        ffmpegPath,
        ['-version'],
        { timeout: 10000, windowsHide: true },
        (err, stdout) => {
          if (err) {
            resolve({ ok: false, error: spawnErrorMessage(err) });
            return;
          }
          const firstLine = (stdout || '').split(/\r?\n/)[0]?.trim() ?? '';
          if (!firstLine) {
            resolve({ ok: false, error: '无法解析 ffmpeg 版本' });
            return;
          }
          // program name = first token of the first line; the rest of the line
          // always contains "FFmpeg developers" (also for ffprobe/ffplay), so we
          // must match the program name, not the whole line.
          const prog = firstLine.split(/\s+/)[0].toLowerCase();
          if (prog.includes('ffplay') || prog.includes('ffprobe')) {
            resolve({ ok: false, error: '这是 ffplay/ffprobe，不是 ffmpeg' });
            return;
          }
          if (prog.includes('ffmpeg')) {
            resolve({ ok: true, version: firstLine });
            return;
          }
          resolve({ ok: false, error: '无法确认该程序是 ffmpeg' });
        },
      );
    } catch (err) {
      resolve({
        ok: false,
        error: spawnErrorMessage(
          err as { code?: string | number | null; message?: string },
        ),
      });
    }
  });
}

export function validatePython(pythonPath: string): Promise<PythonValidation> {
  return new Promise((resolve) => {
    if (!pythonPath) {
      resolve({ ok: false, error: '未配置 Python 解释器路径' });
      return;
    }
    if (!fs.existsSync(pythonPath)) {
      resolve({ ok: false, error: '文件不存在' });
      return;
    }
    let stat;
    try {
      stat = fs.statSync(pythonPath);
    } catch {
      resolve({ ok: false, error: '无法访问该路径' });
      return;
    }
    if (stat.isDirectory()) {
      resolve({
        ok: false,
        error: '所选路径是文件夹，请选择 python 可执行文件',
      });
      return;
    }
    // One-shot probe: import the required inference deps + print the version.
    // If any dep is missing the process exits non-zero and stderr mentions it.
    const probe = [
      '-c',
      'import sys, stable_whisper, faster_whisper, demucs, numpy; print("NECO_PY_OK", sys.version.split()[0])',
    ];
    try {
      execFile(
        pythonPath,
        probe,
        { timeout: 20000, windowsHide: true, encoding: 'utf8' },
        (err, stdout, stderr) => {
          if (err) {
            const text = `${stderr || ''}${stdout || ''}`;
            if (/No module named|ModuleNotFoundError/.test(text)) {
              resolve({
                ok: false,
                error:
                  '缺少依赖（stable-ts / faster-whisper / demucs / numpy），请先运行 python\\conda-env.bat 安装环境',
              });
              return;
            }
            resolve({ ok: false, error: spawnErrorMessage(err) });
            return;
          }
          const m = /NECO_PY_OK\s+(\S+)/.exec(stdout || '');
          if (!m) {
            resolve({ ok: false, error: '无法解析 Python 版本' });
            return;
          }
          resolve({ ok: true, version: `Python ${m[1]}`, depsOk: true });
        },
      );
    } catch (err) {
      resolve({
        ok: false,
        error: spawnErrorMessage(
          err as { code?: string | number | null; message?: string },
        ),
      });
    }
  });
}

// ── Cached backend status ───────────────────────────────────────────────
// Validated lazily and cached by config key, so opening the auto-timing
// dialog doesn't re-spawn python (importing torch is slow). Invalidated on
// config change; warmed up once at app startup.

let statusCache: {
  key: string;
  python: PythonValidation;
  ffmpeg: FfmpegValidation;
} | null = null;

/** Forget cached validation results (e.g. after a config change). */
export function invalidateBackendStatus(): void {
  statusCache = null;
}

/** Python/ffmpeg availability for auto timing, cached per config. */
export async function getBackendStatus(): Promise<{
  pythonOk: boolean;
  ffmpegOk: boolean;
  whisperLanguages: Array<{ code: string; id: number }>;
}> {
  const config = readConfig();
  const key = `${config.ffmpegPath}\u0000${config.pythonPath}`;
  if (!statusCache || statusCache.key !== key) {
    statusCache = {
      key,
      python: config.pythonPath
        ? await validatePython(config.pythonPath)
        : { ok: false, error: '未配置 Python 解释器路径' },
      ffmpeg: config.ffmpegPath
        ? await validateFfmpeg(config.ffmpegPath)
        : { ok: false, error: '未配置 ffmpeg 路径' },
    };
  }
  const whisperLanguages = WHISPER_LANGUAGES.map((code) => ({
    code,
    id: whisperLanguageId(code) ?? -1,
  }));
  return {
    pythonOk: statusCache.python.ok,
    ffmpegOk: statusCache.ffmpeg.ok,
    whisperLanguages,
  };
}

export function registerResourcesHandlers(): void {
  ipcMain.handle(IPC.RESOURCES_GET_CONFIG, () => readConfig());

  ipcMain.handle(IPC.RESOURCES_SET_CONFIG, (_event, config: ResourceConfig) => {
    const merged: ResourceConfig = {
      ffmpegPath:
        typeof config?.ffmpegPath === 'string' ? config.ffmpegPath.trim() : '',
      pythonPath:
        typeof config?.pythonPath === 'string' ? config.pythonPath.trim() : '',
    };
    writeConfig(merged);
    invalidateBackendStatus();
    return merged;
  });

  ipcMain.handle(
    IPC.RESOURCES_PICK_DIRECTORY,
    async (_event, title?: string) => {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: title || '选择模型目录',
        properties: ['openDirectory', 'createDirectory'],
      });
      return canceled || filePaths.length === 0 ? null : filePaths[0];
    },
  );

  ipcMain.handle(IPC.RESOURCES_PICK_FILE, async (_event, title?: string) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: title || '选择 ffmpeg 可执行文件',
      properties: ['openFile'],
    });
    return canceled || filePaths.length === 0 ? null : filePaths[0];
  });

  ipcMain.handle(IPC.RESOURCES_VALIDATE_FFMPEG, (_event, ffmpegPath: string) =>
    validateFfmpeg(ffmpegPath),
  );

  ipcMain.handle(IPC.RESOURCES_VALIDATE_PYTHON, (_event, pythonPath: string) =>
    validatePython(pythonPath),
  );
}
