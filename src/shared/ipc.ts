//
// ipc.ts — IPC channel name constants
// Centralised so both main and renderer use the same strings.
//

const IPC = {
  /** Read a text file from the filesystem: invoke(relativePath) → string */
  READ_TEXT_FILE: 'fs:readTextFile',

  /** Read a file as base64 data-URL: invoke(relativePath) → string */
  READ_FILE_DATA_URL: 'fs:readFileDataUrl',
} as const;

export default IPC;
