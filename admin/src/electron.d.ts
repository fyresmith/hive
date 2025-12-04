export interface ServerAPI {
  start: () => Promise<{ success: boolean; logs: string[] }>;
  stop: () => Promise<{ success: boolean }>;
  getStatus: () => Promise<{ running: boolean; logs: string[] }>;
  getLogs: () => Promise<string[]>;
  onLog: (callback: (log: string) => void) => void;
  onStatusChange: (callback: (running: boolean) => void) => void;
}

export interface ElectronAPI {
  server: ServerAPI;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

