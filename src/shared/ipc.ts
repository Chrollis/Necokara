//
// ipc.ts — IPC channel name constants + type-safe protocol
// Centralised so both main and renderer use the same strings & types.
//

export interface IpcChannelMap {
  'fs:readTextFile': { args: [relativePath: string]; result: string };
  'fs:readFileDataUrl': { args: [relativePath: string]; result: string };
  'fs:fileExists': { args: [filePath: string]; result: boolean };
  'project:save': {
    args: [data: string, currentPath?: string, password?: string];
    result: { filePath: string } | null;
  };
  'project:saveDirect': {
    args: [data: string, filePath: string, password?: string];
    result: { filePath: string } | null;
  };
  'project:open': {
    args: [password?: string];
    result:
      | {
          filePath: string;
          projectJson: unknown;
          lyrics: unknown;
          timing: unknown;
        }
      | { filePath: string; error: 'bad_password' }
      | null;
  };
  'project:openPath': {
    args: [filePath: string, password?: string];
    result:
      | {
          filePath: string;
          projectJson: unknown;
          lyrics: unknown;
          timing: unknown;
        }
      | { filePath: string; error: 'bad_password' }
      | null;
  };
  'audio:open': {
    args: [];
    result: { filePath: string; dataUrl: string } | null;
  };
  'separate:audio': {
    args: [
      audioData: Float32Array[],
      sampleRate: number,
      options: {
        computeInstru: boolean;
        outputDir?: string | null;
        exportBaseName?: string | null;
      },
    ];
    result:
      { vocalsPath: string; exported: string[] } | { error: string } | null;
  };
  'whisper:align': {
    args: [
      vocalsPath: string,
      languageToken: number,
      clean?: { enabled: boolean; threshold: number },
    ];
    result:
      | {
          segments: Array<{
            start: number;
            end: number;
            text: string;
            tokens: number[];
            /** per-token cross-attention (word timestamps), when the model
             * exposes it; may be null/undefined over IPC for old models */
            crossAttn?: Float32Array | number[] | null;
            wordTimes?: Array<{
              start: number;
              end: number;
              text: string;
            }> | null;
            windowOffset?: number;
          }>;
        }
      | { error: string }
      | null;
  };
  'audio:readBuffer': {
    args: [audioFilePath: string];
    result: { data: ArrayBuffer } | { error: string } | null;
  };
  'audio:wavInfo': {
    args: [filePath: string];
    result: { sampleRate: number; frames: number } | { error: string } | null;
  };
  'autoTiming:check': {
    args: [];
    result: {
      separateModelOk: boolean;
      whisperModelOk: boolean;
      whisperLanguages: Array<{ code: string; id: number }>;
    };
  };
  'bpm:detect': {
    args: [audioData: Float32Array, sampleRate: number];
    result:
      | {
          bpm: number;
          ticks: number[];
          segments: Array<{ bpm: number; start: number }>;
        }
      | { error: string }
      | null;
  };
  'resources:getConfig': { args: []; result: ResourceConfig };
  'resources:setConfig': {
    args: [config: ResourceConfig];
    result: ResourceConfig;
  };
  'resources:pickDirectory': { args: [title?: string]; result: string | null };
  'resources:pickFile': { args: [title?: string]; result: string | null };
  'resources:validateFfmpeg': {
    args: [ffmpegPath: string];
    result: FfmpegValidation;
  };
  'resources:inspectModelDir': {
    args: [dir: string];
    result: ModelDirInspection;
  };
}

/** External dependency settings (user-provided paths). */
export interface ResourceConfig {
  modelDir: string;
  ffmpegPath: string;
}

/** Result of running `ffmpeg -version`. */
export interface FfmpegValidation {
  ok: boolean;
  version?: string;
  error?: string;
}

/** Inspection of a model directory: existence + structure + interface issues. */
export interface ModelDirIssue {
  severity: 'error' | 'warn';
  message: string;
}

export interface ModelDirInspection {
  exists: boolean;
  onnxFiles: string[];
  /** resolved separate model file (absolute), or null */
  separateModel: string | null;
  /** whisper model dir (absolute), or null */
  whisperModel: string | null;
  /** structural / interface issues (empty = OK) */
  issues: ModelDirIssue[];
}

/** Type-safe invoke helper — maps channel name to its args/result types. */
export async function ipcInvoke<TChannel extends keyof IpcChannelMap>(
  channel: TChannel,
  ...args: IpcChannelMap[TChannel]['args']
): Promise<IpcChannelMap[TChannel]['result']> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  return w.electron?.ipcRenderer.invoke(channel, ...args);
}

const IPC = {
  READ_TEXT_FILE: 'fs:readTextFile' as const,
  READ_FILE_DATA_URL: 'fs:readFileDataUrl' as const,
  FILE_EXISTS: 'fs:fileExists' as const,
  PROJECT_SAVE: 'project:save' as const,
  PROJECT_SAVE_DIRECT: 'project:saveDirect' as const,
  PROJECT_OPEN: 'project:open' as const,
  PROJECT_OPEN_PATH: 'project:openPath' as const,
  OPEN_AUDIO: 'audio:open' as const,
  SEPARATE_AUDIO: 'separate:audio' as const,
  SEPARATE_PROGRESS: 'separate:progress' as const,
  WHISPER_ALIGN: 'whisper:align' as const,
  WHISPER_ALIGN_PROGRESS: 'whisper:align-progress' as const,
  AUDIO_READ_BUFFER: 'audio:readBuffer' as const,
  AUDIO_WAV_INFO: 'audio:wavInfo' as const,
  AUTO_TIMING_CHECK: 'autoTiming:check' as const,
  BPM_DETECT: 'bpm:detect' as const,
  RESOURCES_GET_CONFIG: 'resources:getConfig' as const,
  RESOURCES_SET_CONFIG: 'resources:setConfig' as const,
  RESOURCES_PICK_DIRECTORY: 'resources:pickDirectory' as const,
  RESOURCES_PICK_FILE: 'resources:pickFile' as const,
  RESOURCES_VALIDATE_FFMPEG: 'resources:validateFfmpeg' as const,
  RESOURCES_INSPECT_MODEL_DIR: 'resources:inspectModelDir' as const,
  LOG: 'log:message' as const,
  UPDATE_AVAILABLE: 'update:available' as const,
  UPDATE_NOT_AVAILABLE: 'update:not-available' as const,
  UPDATE_ERROR: 'update:error' as const,
  UPDATE_PROGRESS: 'update:progress' as const,
  UPDATE_DOWNLOADED: 'update:downloaded' as const,
  UPDATE_INSTALL: 'update:install' as const,
};

/** Serializable wrapper for Float32Array over IPC. */
export interface FloatArrayData {
  type: 'Float32Array';
  data: number[];
}

/** Encode a Float32Array into a plain object for IPC serialization. */
export function encodeFloatArray(arr: Float32Array): FloatArrayData {
  return { type: 'Float32Array', data: Array.from(arr) };
}

/** Decode a FloatArrayData back into a Float32Array. */
export function decodeFloatArray(obj: FloatArrayData): Float32Array {
  return new Float32Array(obj.data);
}

export default IPC;
