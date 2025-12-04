import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  server: {
    start: () => ipcRenderer.invoke('server:start'),
    stop: () => ipcRenderer.invoke('server:stop'),
    getStatus: () => ipcRenderer.invoke('server:status'),
    getLogs: () => ipcRenderer.invoke('server:getLogs'),
    onLog: (callback: (log: string) => void) => {
      ipcRenderer.on('server-log', (_event, log) => callback(log));
    },
    onStatusChange: (callback: (running: boolean) => void) => {
      ipcRenderer.on('server-status', (_event, running) => callback(running));
    }
  }
});

