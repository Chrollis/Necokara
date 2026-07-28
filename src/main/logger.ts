/**
 * Main-process logger.
 *
 * - Writes logs to a file via electron-log.
 * - Listens for 'log' IPC messages from the renderer.
 * - Overrides console in the main process so all console.* calls go to file.
 */
import log from 'electron-log';
import { ipcMain } from 'electron';
import IPC from '../shared/ipc';

export function initLogger(): void {
  // --- Configuration ---
  log.transports.file.maxSize = 5 * 1024 * 1024; // 5 MB per file
  log.transports.file.fileName = 'necokara.log';
  log.transports.file.format =
    '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';

  // In development also keep console output
  log.transports.console.level =
    process.env.NODE_ENV === 'development' ? 'debug' : false;

  // --- Override main-process console ---
  console.log = (...args: unknown[]) => log.info(...args);
  console.warn = (...args: unknown[]) => log.warn(...args);
  console.error = (...args: unknown[]) => log.error(...args);
  console.debug = (...args: unknown[]) => log.debug(...args);

  // --- Listen for renderer logs via IPC ---
  ipcMain.on(IPC.LOG, (_event, level: string, ...args: unknown[]) => {
    switch (level) {
      case 'error':
        log.error('[renderer]', ...args);
        break;
      case 'warn':
        log.warn('[renderer]', ...args);
        break;
      case 'debug':
        log.debug('[renderer]', ...args);
        break;
      default:
        log.info('[renderer]', ...args);
    }
  });
}
