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
let forceClose = false;

if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

const isDebug =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

if (isDebug) {
  require('electron-debug').default({ showDevTools: false });
}

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    show: false,
    width: 1024,
    height: 728,
    title: 'Necokara',
    frame: false,
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

  mainWindow.on('close', (e) => {
    if (!forceClose) {
      e.preventDefault();
      mainWindow?.webContents.send('window:requestClose');
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

  const resolvePath = (p: string) =>
    nodePath.isAbsolute(p) ? p : nodePath.join(baseDir, p);

  ipcMain.handle(IPC.READ_TEXT_FILE, (_event, relativePath: string) => {
    const fullPath = resolvePath(relativePath);
    return fs.readFileSync(fullPath, 'utf-8');
  });

  ipcMain.handle(IPC.READ_FILE_DATA_URL, (_event, relativePath: string) => {
    const fullPath = resolvePath(relativePath);
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

function registerWindowHandlers() {
  const { BrowserWindow } = require('electron');
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.on('window:close', () => mainWindow?.close());
  ipcMain.on('window:forceClose', () => {
    forceClose = true;
    mainWindow?.close();
  });
  ipcMain.handle(
    'window:isMaximized',
    () => mainWindow?.isMaximized() ?? false,
  );
}

function registerProjectHandlers() {
  const fs = require('node:fs');
  const nodePath = require('node:path');
  const { dialog } = require('electron');
  const {
    ZipWriter,
    ZipReader,
    BlobReader,
    BlobWriter,
    TextWriter,
  } = require('@zip.js/zip.js');

  const PW_SUFFIX = 'neco@2525';

  ipcMain.handle(IPC.FILE_EXISTS, (_event, filePath: string) => {
    try {
      fs.accessSync(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle(IPC.OPEN_AUDIO, async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '导入音频',
      filters: [
        {
          name: '音频文件',
          extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'wma'],
        },
      ],
      properties: ['openFile'],
    });
    if (canceled || filePaths.length === 0) return null;
    const filePath = filePaths[0];
    const buf = fs.readFileSync(filePath);
    const ext = nodePath.extname(filePath).toLowerCase();
    const mime: Record<string, string> = {
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.flac': 'audio/flac',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
      '.wma': 'audio/x-ms-wma',
    };
    const contentType = mime[ext] || 'application/octet-stream';
    const base64 = buf.toString('base64');
    return { filePath, dataUrl: `data:${contentType};base64,${base64}` };
  });

  function makeKey(pw?: string) {
    return (pw || '') + PW_SUFFIX;
  }

  async function writeZipFile(
    data: string,
    filePath: string,
    password?: string,
  ) {
    const project = JSON.parse(data);
    const key = makeKey(password);
    const zipWriter = new ZipWriter(new BlobWriter(), { password: key });

    const addFile = async (name: string, content: string) => {
      const blob = new Blob([content], { type: 'application/json' });
      await zipWriter.add(name, new BlobReader(blob));
    };

    await addFile('project.json', JSON.stringify(project.projectJson, null, 2));
    await addFile('data/lyrics.json', JSON.stringify(project.lyrics, null, 2));
    await addFile('inner/timing.json', JSON.stringify(project.timing, null, 2));

    const blob = await zipWriter.close();
    const buf = Buffer.from(await blob.arrayBuffer());
    fs.writeFileSync(filePath, buf);
    return { filePath };
  }

  ipcMain.handle(
    IPC.PROJECT_SAVE,
    async (_event, data: string, currentPath?: string, password?: string) => {
      const { filePath, canceled } = await dialog.showSaveDialog({
        title: '保存项目',
        defaultPath: currentPath || 'untitled.nekoproj',
        filters: [{ name: 'Necokara 项目', extensions: ['nekoproj'] }],
      });
      if (canceled || !filePath) return null;
      return writeZipFile(data, filePath, password);
    },
  );

  ipcMain.handle(
    IPC.PROJECT_SAVE_DIRECT,
    async (_event, data: string, filePath: string, password?: string) => {
      return writeZipFile(data, filePath, password);
    },
  );

  async function tryExtractProject(filePath: string, password?: string) {
    const buf = fs.readFileSync(filePath);
    const blob = new Blob([buf], { type: 'application/octet-stream' });
    const keysToTry = password ? [makeKey(password)] : [makeKey()];
    for (const key of keysToTry) {
      try {
        const reader = new ZipReader(new BlobReader(blob), { password: key });
        const entries = await reader.getEntries();
        const readEntry = async (name: string): Promise<string> => {
          const entry = entries.find((e: any) => e.filename === name);
          if (!entry) throw new Error(`Missing ${name}`);
          return await entry.getData(new TextWriter());
        };
        const result = {
          filePath,
          projectJson: JSON.parse(await readEntry('project.json')),
          lyrics: JSON.parse(await readEntry('data/lyrics.json')),
          timing: JSON.parse(await readEntry('inner/timing.json')),
        };
        await reader.close();
        return result;
      } catch {
        continue;
      }
    }
    return { filePath, error: 'bad_password' };
  }

  ipcMain.handle(IPC.PROJECT_OPEN, async (_event, password?: string) => {
    const { filePaths, canceled } = await dialog.showOpenDialog({
      title: '打开项目',
      filters: [{ name: 'Necokara 项目', extensions: ['nekoproj'] }],
      properties: ['openFile'],
    });
    if (canceled || filePaths.length === 0) return null;
    return tryExtractProject(filePaths[0], password);
  });

  ipcMain.handle(
    IPC.PROJECT_OPEN_PATH,
    async (_event, filePath: string, password?: string) => {
      return tryExtractProject(filePath, password);
    },
  );
}

app
  .whenReady()
  .then(() => {
    registerFsHandlers();
    registerProjectHandlers();
    registerWindowHandlers();
    createWindow();
    app.on('activate', () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (mainWindow === null) createWindow();
    });
  })
  .catch(console.log);
