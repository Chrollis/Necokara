//
// ipc.ts — IPC channel name constants
// Centralised so both main and renderer use the same strings.
//

const IPC = {
  /** Read a text file from the filesystem: invoke(relativePath) → string */
  READ_TEXT_FILE: 'fs:readTextFile',

  /** Read a file as base64 data-URL: invoke(relativePath) → string */
  READ_FILE_DATA_URL: 'fs:readFileDataUrl',

  /** Show save dialog and write .nekoproj: invoke(data, currentPath?, password?) → { filePath } | null */
  PROJECT_SAVE: 'project:save',

  /** Directly write to an existing path without dialog: invoke(data, filePath, password?) → { filePath } | null */
  PROJECT_SAVE_DIRECT: 'project:saveDirect',

  /** Show open dialog and read .nekoproj: invoke(password?) → result | { error: 'bad_password' } | null */
  PROJECT_OPEN: 'project:open',

  /** Open a specific file path: invoke(filePath, password?) → result | { error: 'bad_password' } | null */
  PROJECT_OPEN_PATH: 'project:openPath',

  /** Check if file exists at path: invoke(filePath) → boolean */
  FILE_EXISTS: 'fs:fileExists',

  /** Show audio file open dialog: invoke() → { filePath, dataUrl } | null */
  OPEN_AUDIO: 'audio:open',
} as const;

export default IPC;
