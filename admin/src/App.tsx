import { useState, useEffect, useCallback } from 'react';
import { autoLogin } from './api.ts';
import Sidebar from './components/Sidebar.tsx';
import ConsoleView from './components/ConsoleView.tsx';
import UsersView from './components/UsersView.tsx';
import RequestsView from './components/RequestsView.tsx';
import VaultsView from './components/VaultsView.tsx';
import FileViewer from './components/FileViewer.tsx';

type View = 'console' | 'users' | 'requests' | 'vaults';

interface FileViewerState {
  vaultId: string;
  filepath?: string;
}

function TitleBar() {
  return (
    <div className="titlebar">
      <span className="titlebar-title">Hive Admin</span>
    </div>
  );
}

const isElectron = !!window.electronAPI;

export default function App() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [serverRunning, setServerRunning] = useState(false);
  const [serverLogs, setServerLogs] = useState<string[]>([]);
  const [currentView, setCurrentView] = useState<View>('console');
  const [fileViewer, setFileViewer] = useState<FileViewerState | null>(null);

  const connectToServer = useCallback(async () => {
    try {
      await autoLogin();
      setError(null);
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    async function init() {
      if (isElectron) {
        const api = window.electronAPI!;
        
        api.server.onLog((log) => {
          setServerLogs(prev => [...prev.slice(-499), log]);
        });

        api.server.onStatusChange((running) => {
          setServerRunning(running);
          if (running) {
            setTimeout(async () => {
              await connectToServer();
            }, 2000);
          }
        });

        const status = await api.server.getStatus();
        setServerLogs(status.logs);
        setServerRunning(status.running);

        if (status.running) {
          await connectToServer();
        }
        setLoading(false);
      } else {
        const connected = await connectToServer();
        if (!connected) {
          setError('Failed to connect to server');
        }
        setLoading(false);
      }
    }
    init();
  }, [connectToServer]);

  const handleStartServer = async () => {
    if (!isElectron) return;
    const result = await window.electronAPI!.server.start();
    if (result.success) {
      setServerRunning(true);
      setTimeout(async () => {
        await connectToServer();
      }, 3000);
    }
  };

  const handleStopServer = async () => {
    if (!isElectron) return;
    await window.electronAPI!.server.stop();
    setServerRunning(false);
  };

  const handleOpenFileViewer = (vaultId: string, filepath?: string) => {
    setFileViewer({ vaultId, filepath });
  };

  const handleCloseFileViewer = () => {
    setFileViewer(null);
  };

  if (loading) {
    return (
      <>
        <TitleBar />
        <div className="loading-container">
          <div className="loading-spinner" />
          <p>{isElectron ? 'Starting...' : 'Connecting...'}</p>
        </div>
      </>
    );
  }

  // Browser mode without server control
  if (!isElectron && error) {
    return (
      <>
        <TitleBar />
        <div className="error-container">
          <div className="error-box">
            <h2>Connection Failed</h2>
            <p>{error}</p>
            <p className="error-hint">Make sure the server is running on localhost:3000</p>
            <button className="retry-button" onClick={() => window.location.reload()}>
              Retry
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <TitleBar />
      <div className="app-container">
        <Sidebar
          currentView={currentView}
          onViewChange={setCurrentView}
          serverRunning={serverRunning}
        />
        <main className="main-content">
          {fileViewer ? (
            <FileViewer
              vaultId={fileViewer.vaultId}
              initialFilepath={fileViewer.filepath}
              onClose={handleCloseFileViewer}
            />
          ) : (
            <>
              {currentView === 'console' && (
                <ConsoleView
                  running={serverRunning}
                  logs={serverLogs}
                  onStart={handleStartServer}
                  onStop={handleStopServer}
                />
              )}
              {currentView === 'users' && <UsersView />}
              {currentView === 'requests' && <RequestsView />}
              {currentView === 'vaults' && <VaultsView onOpenVault={handleOpenFileViewer} />}
            </>
          )}
        </main>
      </div>
    </>
  );
}
