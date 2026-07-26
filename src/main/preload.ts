import { contextBridge, ipcRenderer } from 'electron';
import IPC from '../shared/ipc';

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
  fs: {
    readTextFile(relativePath: string) {
      return ipcRenderer.invoke(IPC.READ_TEXT_FILE, relativePath);
    },
    readFileDataUrl(relativePath: string) {
      return ipcRenderer.invoke(IPC.READ_FILE_DATA_URL, relativePath);
    },
  },
};

contextBridge.exposeInMainWorld('electron', electronHandler);

export type ElectronHandler = typeof electronHandler;
