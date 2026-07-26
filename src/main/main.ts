/**
 * Necokara main process.
 * Electron main process — manages window lifecycle and IPC channels.
 */
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import MenuBuilder from './menu';
import { resolveHtmlPath } from './util';
import IPC from '../shared/ipc';

let mainWindow: BrowserWindow | null = null;

if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

const isDebug =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

if (isDebug) {
  require('electron-debug').default();
}

const installExtensions = async () => {
  const installer = require('electron-devtools-installer');
  const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
  const extensions = ['REACT_DEVELOPER_TOOLS'];

  return installer
    .default(
      extensions.map((name) => installer[name]),
      forceDownload,
    )
    .catch(console.log);
};

const createWindow = async () => {
  if (isDebug) {
    await installExtensions();
  }

  mainWindow = new BrowserWindow({
    show: false,
    width: 1024,
    height: 728,
    title: 'Necokara',
    autoHideMenuBar: true,
    webPreferences: {
      preload: app.isPackaged
        ? path.join(__dirname, 'preload.js')
        : path.join(__dirname, '../../.erb/dll/preload.js'),
    },
  });

  mainWindow.loadURL(resolveHtmlPath('index.html'));

  mainWindow.on('ready-to-show', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      mainWindow.show();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(mainWindow);
  menuBuilder.buildMenu();

  // Open urls in the user's browser
  mainWindow.webContents.setWindowOpenHandler((edata) => {
    shell.openExternal(edata.url);
    return { action: 'deny' };
  });
};

/**
 * Add event listeners...
 */

app.on('window-all-closed', () => {
  // Respect the OSX convention of having the application in memory even
  // after all windows have been closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function registerFsHandlers() {
  const fs = require('node:fs');
  const nodePath = require('node:path');
  const baseDir =
    process.env.NODE_ENV === 'development'
      ? process.cwd()
      : nodePath.dirname(app.getPath('exe'));

  ipcMain.handle(IPC.READ_TEXT_FILE, (_event, relativePath: string) => {
    const fullPath = nodePath.join(baseDir, relativePath);
    return fs.readFileSync(fullPath, 'utf-8');
  });

  ipcMain.handle(IPC.READ_FILE_DATA_URL, (_event, relativePath: string) => {
    const fullPath = nodePath.join(baseDir, relativePath);
    const buf = fs.readFileSync(fullPath);
    const ext = nodePath.extname(relativePath).toLowerCase();
    const mime: Record<string, string> = {
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.flac': 'audio/flac',
    };
    const contentType = mime[ext] || 'application/octet-stream';
    const base64 = buf.toString('base64');
    return `data:${contentType};base64,${base64}`;
  });
}

app
  .whenReady()
  .then(() => {
    registerFsHandlers();
    createWindow();
    app.on('activate', () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (mainWindow === null) createWindow();
    });
  })
  .catch(console.log);
