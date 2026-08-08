import { contextBridge, ipcRenderer } from 'electron';
import IPC, { ResourceConfig } from '../shared/ipc';

const electronHandler = {
  ipcRenderer: {
    send(channel: string, ...args: unknown[]) {
      ipcRenderer.send(channel, ...args);
    },
    on(channel: string, callback: (...args: unknown[]) => void) {
      const listener = (
        _event: Electron.IpcRendererEvent,
        ...args: unknown[]
      ) => callback(...args);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
    invoke(channel: string, ...args: unknown[]) {
      return ipcRenderer.invoke(channel, ...args);
    },
  },
  resources: {
    getConfig() {
      return ipcRenderer.invoke(IPC.RESOURCES_GET_CONFIG);
    },
    setConfig(config: ResourceConfig) {
      return ipcRenderer.invoke(IPC.RESOURCES_SET_CONFIG, config);
    },
    pickDirectory(title?: string) {
      return ipcRenderer.invoke(IPC.RESOURCES_PICK_DIRECTORY, title);
    },
    pickFile(title?: string) {
      return ipcRenderer.invoke(IPC.RESOURCES_PICK_FILE, title);
    },
    validateFfmpeg(ffmpegPath: string) {
      return ipcRenderer.invoke(IPC.RESOURCES_VALIDATE_FFMPEG, ffmpegPath);
    },
    validatePython(pythonPath: string) {
      return ipcRenderer.invoke(IPC.RESOURCES_VALIDATE_PYTHON, pythonPath);
    },
  },
  fs: {
    readTextFile(relativePath: string) {
      return ipcRenderer.invoke(IPC.READ_TEXT_FILE, relativePath);
    },
    readFileDataUrl(relativePath: string) {
      return ipcRenderer.invoke(IPC.READ_FILE_DATA_URL, relativePath);
    },
    fileExists(filePath: string) {
      return ipcRenderer.invoke(IPC.FILE_EXISTS, filePath);
    },
  },
  project: {
    save(data: string, currentPath?: string, password?: string) {
      return ipcRenderer.invoke(IPC.PROJECT_SAVE, data, currentPath, password);
    },
    saveDirect(data: string, filePath: string, password?: string) {
      return ipcRenderer.invoke(
        IPC.PROJECT_SAVE_DIRECT,
        data,
        filePath,
        password,
      );
    },
    open(password?: string) {
      return ipcRenderer.invoke(IPC.PROJECT_OPEN, password);
    },
    openPath(filePath: string, password?: string) {
      return ipcRenderer.invoke(IPC.PROJECT_OPEN_PATH, filePath, password);
    },
    openAudio() {
      return ipcRenderer.invoke(IPC.OPEN_AUDIO);
    },
  },
  window: {
    minimize() {
      ipcRenderer.send('window:minimize');
    },
    maximize() {
      ipcRenderer.send('window:maximize');
    },
    close() {
      ipcRenderer.send('window:close');
    },
    forceClose() {
      ipcRenderer.send('window:forceClose');
    },
    isMaximized() {
      return ipcRenderer.invoke('window:isMaximized');
    },
    onMaximizedChange(callback: (maximized: boolean) => void) {
      const sub = (_event: Electron.IpcRendererEvent, maximized: boolean) =>
        callback(maximized);
      ipcRenderer.on('window:maximized-changed', sub);
      return () => ipcRenderer.removeListener('window:maximized-changed', sub);
    },
    onRequestClose(callback: () => void) {
      const sub = (_event: Electron.IpcRendererEvent) => callback();
      ipcRenderer.on('window:requestClose', sub);
      return () => ipcRenderer.removeListener('window:requestClose', sub);
    },
  },
};

contextBridge.exposeInMainWorld('electron', electronHandler);

export type ElectronHandler = typeof electronHandler;
