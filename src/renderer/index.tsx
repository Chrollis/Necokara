import { createRoot } from 'react-dom/client';
import App from './App';

// Forward all renderer console output to the main process for file logging
const send = window.electron?.ipcRenderer.send.bind(
  window.electron.ipcRenderer,
);
if (send) {
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };
  console.log = (...args: unknown[]) => {
    original.log(...args);
    send('log:message', 'info', ...args);
  };
  console.warn = (...args: unknown[]) => {
    original.warn(...args);
    send('log:message', 'warn', ...args);
  };
  console.error = (...args: unknown[]) => {
    original.error(...args);
    send('log:message', 'error', ...args);
  };
  console.debug = (...args: unknown[]) => {
    original.debug(...args);
    send('log:message', 'debug', ...args);
  };
}

const container = document.getElementById('root') as HTMLElement;
const root = createRoot(container);
root.render(<App />);
