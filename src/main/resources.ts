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
  ModelDirInspection,
  ModelDirIssue,
  ResourceConfig,
} from '../shared/ipc';

const DEFAULT_CONFIG: ResourceConfig = { modelDir: '', ffmpegPath: '' };

function configFilePath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readConfig(): ResourceConfig {
  try {
    const raw = fs.readFileSync(configFilePath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<ResourceConfig>;
    return {
      modelDir: typeof parsed.modelDir === 'string' ? parsed.modelDir : '',
      ffmpegPath:
        typeof parsed.ffmpegPath === 'string' ? parsed.ffmpegPath : '',
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

/**
 * 在模型目录下查找人声分离模型（约定：`separate/*.onnx` 优先，
 * 其次根目录任意 `.onnx`）。返回绝对路径或 null。
 */
export function findSeparateModel(modelDir: string): string | null {
  if (!modelDir) return null;
  const candidates: string[] = [];
  try {
    const sepDir = path.join(modelDir, 'separate');
    if (fs.existsSync(sepDir) && fs.statSync(sepDir).isDirectory()) {
      for (const name of fs.readdirSync(sepDir)) {
        if (name.toLowerCase().endsWith('.onnx')) {
          candidates.push(path.join(sepDir, name));
        }
      }
    }
  } catch {
    /* ignore */
  }
  if (candidates.length === 0) {
    try {
      for (const name of fs.readdirSync(modelDir)) {
        if (name.toLowerCase().endsWith('.onnx')) {
          candidates.push(path.join(modelDir, name));
        }
      }
    } catch {
      /* ignore */
    }
  }
  candidates.sort((a, b) => a.localeCompare(b));
  return candidates[0] ?? null;
}

/**
 * 在模型目录下查找 whisper 对齐模型（约定：`whisper/onnx/encoder_model.onnx` +
 * `decoder_model.onnx` + `whisper/vocab.json` + `whisper/tokenizer.json`）。
 * 返回 `whisper` 目录绝对路径或 null。
 */
export function findWhisperModel(modelDir: string): string | null {
  if (!modelDir) return null;
  const whisperDir = path.join(modelDir, 'whisper');
  const onnxDir = path.join(whisperDir, 'onnx');
  try {
    const needed = [
      path.join(onnxDir, 'encoder_model.onnx'),
      path.join(onnxDir, 'decoder_model.onnx'),
      path.join(whisperDir, 'vocab.json'),
      path.join(whisperDir, 'tokenizer.json'),
    ];
    if (needed.every((f) => fs.existsSync(f))) return whisperDir;
  } catch {
    /* ignore */
  }
  return null;
}

function ffmpegSpawnErrorMessage(err: {
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
            resolve({ ok: false, error: ffmpegSpawnErrorMessage(err) });
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
        error: ffmpegSpawnErrorMessage(
          err as { code?: string | number | null; message?: string },
        ),
      });
    }
  });
}

// onnx metadata interface checks (load session once per path, no inference)
const interfaceChecked = new Set<string>();

function loadOnnx(): any {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return eval('require')('onnxruntime-node');
}

async function checkSeparateInterface(
  modelPath: string,
  issues: ModelDirIssue[],
): Promise<void> {
  if (interfaceChecked.has(modelPath)) return;
  interfaceChecked.add(modelPath);
  try {
    const ort = loadOnnx();
    const s = await ort.InferenceSession.create(modelPath, {
      executionProviders: ['cpu'],
    });
    const inp = s.inputMetadata[0];
    const dims = inp ? (inp.shape as number[]) : [];
    if (dims.length !== 4 || dims[1] !== 4) {
      issues.push({
        severity: 'error',
        message: `分离模型接口不符（期望输入 [1,4,3072,256]，实际 [${dims.join(',')}]）`,
      });
    }
  } catch (e) {
    issues.push({
      severity: 'error',
      message: `分离模型无法加载：${e instanceof Error ? e.message : String(e)}`,
    });
  }
}

async function checkWhisperInterface(
  wOnnxDir: string,
  issues: ModelDirIssue[],
): Promise<void> {
  if (interfaceChecked.has(wOnnxDir)) return;
  interfaceChecked.add(wOnnxDir);
  try {
    const ort = loadOnnx();
    const enc = await ort.InferenceSession.create(
      path.join(wOnnxDir, 'encoder_model.onnx'),
      { executionProviders: ['cpu'] },
    );
    const encIn = enc.inputMetadata[0];
    if (encIn && encIn.name !== 'input_features') {
      issues.push({
        severity: 'error',
        message: `whisper encoder 输入名应为 input_features（实际 ${encIn.name}）`,
      });
    }
    const dec = await ort.InferenceSession.create(
      path.join(wOnnxDir, 'decoder_model.onnx'),
      { executionProviders: ['cpu'] },
    );
    const names = dec.inputMetadata.map((m: { name: string }) => m.name);
    if (
      !names.includes('input_ids') ||
      !names.includes('encoder_hidden_states')
    ) {
      issues.push({
        severity: 'error',
        message: 'whisper decoder 输入应为 input_ids + encoder_hidden_states',
      });
    }
  } catch (e) {
    issues.push({
      severity: 'error',
      message: `whisper 模型无法加载：${e instanceof Error ? e.message : String(e)}`,
    });
  }
}

export async function inspectModelDir(
  dir: string,
): Promise<ModelDirInspection> {
  const issues: ModelDirIssue[] = [];
  const onnxFiles: string[] = [];
  if (!dir) {
    return {
      exists: false,
      onnxFiles: [],
      separateModel: null,
      whisperModel: null,
      issues: [{ severity: 'error', message: '未设置模型目录' }],
    };
  }

  let exists = false;
  try {
    exists = fs.existsSync(dir) && fs.statSync(dir).isDirectory();
  } catch {
    exists = false;
  }
  if (!exists) {
    return {
      exists: false,
      onnxFiles: [],
      separateModel: null,
      whisperModel: null,
      issues: [{ severity: 'error', message: '目录不存在' }],
    };
  }

  // recursive onnx scan (relative paths, e.g. separate/UVR-MDX-NET_Main_438.onnx)
  try {
    const walk = (cur: string, rel: string, depth: number) => {
      if (depth > 5) return;
      for (const name of fs.readdirSync(cur)) {
        const full = path.join(cur, name);
        let stat;
        try {
          stat = fs.statSync(full);
        } catch {
          continue;
        }
        if (stat.isDirectory()) {
          walk(full, rel ? `${rel}/${name}` : name, depth + 1);
        } else if (name.toLowerCase().endsWith('.onnx')) {
          onnxFiles.push(rel ? `${rel}/${name}` : name);
        }
      }
    };
    walk(dir, '', 0);
    onnxFiles.sort((a, b) => a.localeCompare(b));
  } catch {
    /* ignore */
  }

  // separate model: only ONE allowed under separate/
  let separateModel: string | null = null;
  const sepDir = path.join(dir, 'separate');
  let sepOnnx: string[] = [];
  try {
    if (fs.existsSync(sepDir) && fs.statSync(sepDir).isDirectory()) {
      sepOnnx = fs
        .readdirSync(sepDir)
        .filter((n) => n.toLowerCase().endsWith('.onnx'));
    }
  } catch {
    /* ignore */
  }
  if (sepOnnx.length > 0) {
    if (sepOnnx.length > 1) {
      issues.push({
        severity: 'error',
        message: `separate/ 下只能有一个分离模型（找到 ${sepOnnx.length} 个）`,
      });
    }
    separateModel = path.join(sepDir, sepOnnx[0]);
  } else {
    // fallback: a single onnx at the root
    const rootOnnx = onnxFiles.filter((f) => !f.includes('/'));
    if (rootOnnx.length > 0) {
      if (rootOnnx.length > 1) {
        issues.push({
          severity: 'error',
          message: `根目录存在多个 .onnx（${rootOnnx.length} 个），无法确定分离模型`,
        });
      }
      separateModel = path.join(dir, rootOnnx[0]);
    } else {
      issues.push({
        severity: 'error',
        message: '未找到分离模型（期望 separate/*.onnx）',
      });
    }
  }

  // whisper model: fixed file layout, only ONE onnx pair
  const whisperDir = path.join(dir, 'whisper');
  const wOnnxDir = path.join(whisperDir, 'onnx');
  let whisperModel: string | null = null;
  try {
    if (fs.existsSync(whisperDir) && fs.statSync(whisperDir).isDirectory()) {
      const required: Array<[string, string]> = [
        ['encoder_model.onnx', path.join(wOnnxDir, 'encoder_model.onnx')],
        ['decoder_model.onnx', path.join(wOnnxDir, 'decoder_model.onnx')],
        ['vocab.json', path.join(whisperDir, 'vocab.json')],
        ['tokenizer.json', path.join(whisperDir, 'tokenizer.json')],
      ];
      const missing = required
        .filter(([, p]) => !fs.existsSync(p))
        .map(([n]) => n);
      if (missing.length > 0) {
        issues.push({
          severity: 'error',
          message: `whisper/ 缺少必需文件：${missing.join('、')}`,
        });
      } else {
        whisperModel = whisperDir;
        if (fs.existsSync(wOnnxDir) && fs.statSync(wOnnxDir).isDirectory()) {
          const variants = fs
            .readdirSync(wOnnxDir)
            .filter((n) => n.toLowerCase().endsWith('.onnx'));
          const extras = variants.filter(
            (n) => n !== 'encoder_model.onnx' && n !== 'decoder_model.onnx',
          );
          if (extras.length > 0) {
            issues.push({
              severity: 'warn',
              message: `whisper/onnx/ 有额外模型变体（${extras.join('、')}），建议只保留 encoder_model.onnx + decoder_model.onnx`,
            });
          }
        }
      }
    } else {
      issues.push({ severity: 'error', message: '未找到 whisper/ 模型目录' });
    }
  } catch {
    /* ignore */
  }

  // onnx interface checks (load metadata)
  if (separateModel) await checkSeparateInterface(separateModel, issues);
  if (whisperModel) await checkWhisperInterface(wOnnxDir, issues);

  return { exists, onnxFiles, separateModel, whisperModel, issues };
}

export function registerResourcesHandlers(): void {
  ipcMain.handle(IPC.RESOURCES_GET_CONFIG, () => readConfig());

  ipcMain.handle(IPC.RESOURCES_SET_CONFIG, (_event, config: ResourceConfig) => {
    const merged: ResourceConfig = {
      modelDir:
        typeof config?.modelDir === 'string' ? config.modelDir.trim() : '',
      ffmpegPath:
        typeof config?.ffmpegPath === 'string' ? config.ffmpegPath.trim() : '',
    };
    writeConfig(merged);
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

  ipcMain.handle(IPC.RESOURCES_INSPECT_MODEL_DIR, (_event, dir: string) =>
    inspectModelDir(dir),
  );
}
