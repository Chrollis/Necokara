import { useState, useRef, useEffect } from 'react';

export interface SnackBarHandle {
  show: (msg: string, durationMs?: number) => void;
}

export function useSnackBar(): [SnackBarHandle, React.ReactNode] {
  const [msg, setMsg] = useState('');
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show: SnackBarHandle['show'] = (m, durationMs = 2500) => {
    setMsg(m);
    setVisible(true);
    if (timer.current) clearTimeout(timer.current);
    if (durationMs > 0) {
      timer.current = setTimeout(() => setVisible(false), durationMs);
    }
  };

  const node = (
    <div
      className={['snackbar', visible ? 'snackbar-visible' : '']
        .filter(Boolean)
        .join(' ')}
    >
      {msg}
    </div>
  );

  return [{ show }, node];
}
