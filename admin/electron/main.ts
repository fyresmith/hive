import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let serverLogs: string[] = [];
const MAX_LOGS = 500;

function addLog(message: string) {
  const timestamp = new Date().toLocaleTimeString();
  serverLogs.push(`[${timestamp}] ${message}`);
  if (serverLogs.length > MAX_LOGS) {
    serverLogs = serverLogs.slice(-MAX_LOGS);
  }
  // Send to renderer if window exists
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('server-log', `[${timestamp}] ${message}`);
  }
}

/**
 * Get the server directory path
 * In development: ../server (sibling directory)
 * In production: bundled inside the app resources
 */
function getServerDir(): string {
  const isDev = !app.isPackaged;
  
  if (isDev) {
    // Development: use sibling server directory
    return path.join(__dirname, '../../server');
  } else {
    // Production: use bundled server in resources
    return path.join(process.resourcesPath, 'server');
  }
}

/**
 * Get the data directory for server storage
 * In development: server/data
 * In production: app user data directory
 */
function getDataDir(): string {
  const isDev = !app.isPackaged;
  
  if (isDev) {
    return path.join(getServerDir(), 'data');
  } else {
    // Production: store data in user's app data directory
    const dataDir = path.join(app.getPath('userData'), 'server-data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    return dataDir;
  }
}

function startServer(): Promise<boolean> {
  return new Promise((resolve) => {
    if (serverProcess) {
      addLog('Server is already running');
      resolve(true);
      return;
    }

    const serverDir = getServerDir();
    const dataDir = getDataDir();
    const isDev = !app.isPackaged;
    
    addLog(`Starting server from: ${serverDir}`);
    addLog(`Data directory: ${dataDir}`);

    const isWindows = process.platform === 'win32';
    
    let cmd: string;
    let args: string[];
    
    if (isDev) {
      // Development: use ts-node
      const npxCmd = isWindows ? 'npx.cmd' : 'npx';
      cmd = npxCmd;
      args = ['ts-node', 'src/index.ts'];
    } else {
      // Production: run compiled JavaScript with node
      const nodeCmd = isWindows ? 'node.exe' : 'node';
      cmd = nodeCmd;
      args = ['dist/index.js'];
    }
    
    serverProcess = spawn(cmd, args, {
      cwd: serverDir,
      env: { 
        ...process.env, 
        NODE_ENV: isDev ? 'development' : 'production',
        DATA_DIR: dataDir,
        DATABASE_PATH: path.join(dataDir, 'users.db'),
        VAULTS_PATH: path.join(dataDir, 'vaults'),
      },
      shell: true
    });

    let started = false;

    serverProcess.stdout?.on('data', (data: Buffer) => {
      const message = data.toString().trim();
      if (message) {
        addLog(message);
        // Detect when server has started
        if (message.includes('HTTP Server running') && !started) {
          started = true;
          resolve(true);
        }
      }
    });

    serverProcess.stderr?.on('data', (data: Buffer) => {
      const message = data.toString().trim();
      if (message) {
        addLog(`[ERROR] ${message}`);
      }
    });

    serverProcess.on('error', (err) => {
      addLog(`[ERROR] Failed to start server: ${err.message}`);
      serverProcess = null;
      if (!started) resolve(false);
    });

    serverProcess.on('exit', (code) => {
      addLog(`Server exited with code ${code}`);
      serverProcess = null;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('server-status', false);
      }
      if (!started) resolve(false);
    });

    // Timeout after 15 seconds
    setTimeout(() => {
      if (!started) {
        addLog('Server startup timeout - checking if running anyway');
        resolve(serverProcess !== null);
      }
    }, 15000);
  });
}

function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!serverProcess) {
      addLog('Server is not running');
      resolve();
      return;
    }

    addLog('Stopping server...');
    
    const isWindows = process.platform === 'win32';
    if (isWindows) {
      spawn('taskkill', ['/pid', serverProcess.pid!.toString(), '/f', '/t']);
    } else {
      serverProcess.kill('SIGTERM');
    }

    // Force kill after 5 seconds
    const timeout = setTimeout(() => {
      if (serverProcess) {
        serverProcess.kill('SIGKILL');
      }
    }, 5000);

    serverProcess.on('exit', () => {
      clearTimeout(timeout);
      serverProcess = null;
      resolve();
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1e1e1e',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Load the app
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers
ipcMain.handle('server:start', async () => {
  const success = await startServer();
  return { success, logs: serverLogs };
});

ipcMain.handle('server:stop', async () => {
  await stopServer();
  return { success: true };
});

ipcMain.handle('server:status', () => {
  return { 
    running: serverProcess !== null,
    logs: serverLogs
  };
});

ipcMain.handle('server:getLogs', () => {
  return serverLogs;
});

app.whenReady().then(async () => {
  createWindow();

  // Don't auto-start - user must click Start
  addLog('Ready. Click Start Server to begin.');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', async () => {
  await stopServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  await stopServer();
});
