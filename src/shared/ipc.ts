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
}

/** Type-safe invoke helper — maps channel name to its args/result types. */
export async function ipcInvoke<TChannel extends keyof IpcChannelMap>(
  channel: TChannel,
  ...args: IpcChannelMap[TChannel]['args']
): Promise<IpcChannelMap[TChannel]['result']> {
  return window.electron?.ipcRenderer.invoke(channel, ...args);
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
  LOG: 'log:message' as const,
  UPDATE_AVAILABLE: 'update:available' as const,
  UPDATE_NOT_AVAILABLE: 'update:not-available' as const,
  UPDATE_ERROR: 'update:error' as const,
  UPDATE_PROGRESS: 'update:progress' as const,
  UPDATE_DOWNLOADED: 'update:downloaded' as const,
  UPDATE_INSTALL: 'update:install' as const,
};

export default IPC;
