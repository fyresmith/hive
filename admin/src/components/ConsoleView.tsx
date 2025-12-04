import { useRef, useEffect } from 'react';
import { VscDebugStart, VscDebugStop } from 'react-icons/vsc';

interface ConsoleViewProps {
  running: boolean;
  logs: string[];
  onStart: () => void;
  onStop: () => void;
}

export default function ConsoleView({ running, logs, onStart, onStop }: ConsoleViewProps) {
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="console-view">
      <div className="console-header">
        <div className="console-status">
          <span className={`status-indicator ${running ? 'running' : 'stopped'}`}>
            <span className="status-dot" />
            <span>{running ? 'Server Running' : 'Server Stopped'}</span>
          </span>
        </div>
        
        <button 
          className={`server-button ${running ? 'stop' : 'start'}`}
          onClick={running ? onStop : onStart}
        >
          {running ? (
            <>
              <VscDebugStop />
              <span>Stop Server</span>
            </>
          ) : (
            <>
              <VscDebugStart />
              <span>Start Server</span>
            </>
          )}
        </button>
      </div>

      <div className="console-logs">
        <div className="logs-header">
          <span>Output</span>
          <span className="log-count">{logs.length} lines</span>
        </div>
        <div className="logs-content">
          {logs.length === 0 ? (
            <div className="logs-empty">No output yet</div>
          ) : (
            logs.map((log, i) => (
              <div 
                key={i} 
                className={`log-line ${log.includes('[ERROR]') ? 'error' : ''}`}
              >
                {log}
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
}

