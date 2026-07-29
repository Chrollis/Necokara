/**
 * Necokara main process.
 * Electron main process — manages window lifecycle and IPC channels.
 */
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import MenuBuilder from './menu';
import { resolveHtmlPath } from './util';
import IPC from '../shared/ipc';
import { initLogger } from './logger';
import { initUpdater, setMainWindow } from './updater';

app.setName('Necokara');

initLogger();
initUpdater();

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
      sandbox: false,
      preload: app.isPackaged
        ? path.join(__dirname, 'preload.js')
        : path.join(__dirname, '../../.erb/dll/preload.js'),
    },
  });

  mainWindow.loadURL(resolveHtmlPath('index.html'));

  setMainWindow(mainWindow);

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

  // ── Vocal separation via worker thread ──

  /** Write a Float32Array as a 16-bit mono WAV file. */
  function writeWav(filePath: string, samples: Float32Array, sr: number): void {
    const fs = require('fs');
    const numSamples = samples.length;
    const buf = Buffer.alloc(44 + numSamples * 2);
    const w = (off: number, v: number, size: number) => {
      for (let i = 0; i < size; i++) buf[off + i] = (v >> (i * 8)) & 0xff;
    };
    const s = (off: number, str: string) => {
      for (let i = 0; i < str.length; i++) buf[off + i] = str.charCodeAt(i);
    };
    s(0, 'RIFF');
    w(4, 36 + numSamples * 2, 4);
    s(8, 'WAVE');
    s(12, 'fmt ');
    w(16, 16, 4);
    w(20, 1, 2);
    w(22, 1, 2);
    w(24, sr, 4);
    w(28, sr * 2, 4);
    w(32, 2, 2);
    w(34, 16, 2);
    s(36, 'data');
    w(40, numSamples * 2, 4);
    for (let i = 0; i < numSamples; i++) {
      const sample = Math.max(-1, Math.min(1, samples[i]));
      w(44 + i * 2, sample * 0x7fff, 2);
    }
    fs.writeFileSync(filePath, buf);
  }

  ipcMain.handle(
    IPC.SEPARATE_AUDIO,
    async (
      _event,
      audioData: Float32Array,
      sampleRate: number,
      audioFilePath?: string,
    ) => {
      // @ts-expect-error dynamic import resolved by webpack
      const { separate } = await import('./separate');
      try {
        const result = await separate(audioData, sampleRate, (p: number) => {
          _event.sender.send(IPC.SEPARATE_PROGRESS, p);
        });
        if (!result) return { error: 'Separation returned null' };

        // Save vocals/accompaniment alongside the audio file
        if (audioFilePath) {
          try {
            const fs = require('fs');
            const dir = path.dirname(audioFilePath);
            const base = path.basename(
              audioFilePath,
              path.extname(audioFilePath),
            );
            const sr = 44100;
            const vocalPath = path.join(dir, `${base}_vocal.wav`);
            const instruPath = path.join(dir, `${base}_instru.wav`);
            writeWav(vocalPath, result.vocals, sr);
            writeWav(instruPath, result.accompaniment, sr);
          } catch (e) {
            // silent
          }
        }

        return {
          vocals: {
            type: 'Float32Array' as const,
            data: Array.from(result.vocals),
          },
          accompaniment: {
            type: 'Float32Array' as const,
            data: Array.from(result.accompaniment),
          },
          onsets: result.onsets,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[main] separation error:', err);
        return { error: msg };
      }
    },
  );

  // ── BPM detection via worker ──

  ipcMain.handle(
    IPC.BPM_DETECT,
    async (_event, audioData: Float32Array, sampleRate: number) => {
      // @ts-expect-error dynamic import resolved by webpack
      const { detectBpm } = await import('./bpm');
      try {
        const result = await detectBpm(audioData, sampleRate);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[main] bpm error:', err);
        return { error: msg };
      }
    },
  );

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
