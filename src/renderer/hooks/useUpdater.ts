import { useState, useEffect, useCallback, useRef } from 'react';

export type UpdateStatus =
  | { type: 'checking' }
  | { type: 'not-available' }
  | { type: 'available'; version: string; releaseUrl: string }
  | { type: 'downloading'; percent: number; releaseUrl: string }
  | { type: 'downloaded'; version: string; releaseUrl: string }
  | { type: 'error' };

export function useUpdater(snack?: {
  show: (msg: string, durationMs?: number) => void;
}): {
  status: UpdateStatus;
  installUpdate: () => void;
} {
  const [status, setStatus] = useState<UpdateStatus>({ type: 'checking' });
  const snackRef = useRef(snack);
  snackRef.current = snack;

  useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;

    const cleanups: (() => void)[] = [];

    cleanups.push(
      ipc.on('update:available', (args: unknown) => {
        const { version, releaseUrl } = args as {
          version: string;
          releaseUrl: string;
        };
        setStatus({ type: 'available', version, releaseUrl });
        snackRef.current?.show(`发现新版本 v${version}，正在下载…`, 4000);
      }),
    );

    cleanups.push(
      ipc.on('update:not-available', () => {
        setStatus({ type: 'not-available' });
        // optional: snackRef.current?.show('已是最新版本');
      }),
    );

    cleanups.push(
      ipc.on('update:error', () => {
        setStatus({ type: 'error' });
        snackRef.current?.show('检测更新失败', 3000);
      }),
    );

    cleanups.push(
      ipc.on('update:progress', (args: unknown) => {
        const { percent } = args as { percent: number };
        setStatus((prev) => {
          if (prev.type === 'available' || prev.type === 'downloading') {
            return {
              type: 'downloading',
              percent,
              releaseUrl: prev.releaseUrl,
            };
          }
          return prev;
        });
      }),
    );

    cleanups.push(
      ipc.on('update:downloaded', (args: unknown) => {
        const { version, releaseUrl } = args as {
          version: string;
          releaseUrl: string;
        };
        setStatus({ type: 'downloaded', version, releaseUrl });
        snackRef.current?.show('更新已就绪', 5000);
      }),
    );

    return () => cleanups.forEach((fn) => fn());
  }, []);

  const installUpdate = useCallback(() => {
    window.electron?.ipcRenderer.send('update:install');
  }, []);

  return { status, installUpdate };
}
