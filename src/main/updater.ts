/**
 * Main-process auto-updater.
 *
 * Uses electron-updater to check for updates on GitHub Releases.
 * Communicates state changes to the renderer via IPC.
 */
import { autoUpdater } from 'electron-updater';
import { app, ipcMain, BrowserWindow } from 'electron';
import log from 'electron-log';
import IPC from '../shared/ipc';

let mainWindow: BrowserWindow | null = null;

function isPortable(): boolean {
  return app.isPackaged && process.resourcesPath.includes('win-unpacked');
}

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win;
}

export function initUpdater(): void {
  const portable = isPortable();

  autoUpdater.logger = log;
  autoUpdater.autoDownload = !portable;
  autoUpdater.autoInstallOnAppQuit = !portable;
  autoUpdater.allowPrerelease = true;

  // ── Events → renderer ──

  autoUpdater.on('checking-for-update', () => {
    log.info('[updater] checking for updates');
  });

  autoUpdater.on('update-available', (info) => {
    log.info('[updater] update available:', info.version);
    const releaseUrl = `https://github.com/Chrollis/Necokara/releases/tag/v${info.version}`;
    mainWindow?.webContents.send(IPC.UPDATE_AVAILABLE, {
      version: info.version,
      releaseUrl,
      isPortable: portable,
    });
  });

  autoUpdater.on('update-not-available', () => {
    log.info('[updater] already latest');
    mainWindow?.webContents.send(IPC.UPDATE_NOT_AVAILABLE);
  });

  autoUpdater.on('error', (err) => {
    log.error('[updater] error:', err.message);
    mainWindow?.webContents.send(IPC.UPDATE_ERROR);
  });

  autoUpdater.on('download-progress', (progress) => {
    const pct = Math.round(progress.percent);
    mainWindow?.webContents.send(IPC.UPDATE_PROGRESS, { percent: pct });
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info('[updater] downloaded:', info.version);
    const releaseUrl = `https://github.com/Chrollis/Necokara/releases/tag/v${info.version}`;
    mainWindow?.webContents.send(IPC.UPDATE_DOWNLOADED, {
      version: info.version,
      releaseUrl,
      isPortable: isPortable(),
    });
  });

  // ── IPC handler: renderer requests install ──
  ipcMain.on(IPC.UPDATE_INSTALL, () => {
    autoUpdater.quitAndInstall();
  });

  // ── Start check (with a short delay so the window is ready) ──
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      log.error('[updater] check failed:', err.message);
      mainWindow?.webContents.send(IPC.UPDATE_ERROR);
    });
  }, 3000);
}
