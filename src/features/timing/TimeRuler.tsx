import { useMemo, useCallback } from 'react';

interface TimeRulerProps {
  duration: number; // ms (0 = no audio loaded, show 5min default)
  zoomLevel?: number;
  scrollOffset?: number;
  onSeek?: (timeMs: number) => void;
}

export default function TimeRuler({
  duration,
  zoomLevel = 1,
  scrollOffset = 0,
  onSeek,
}: TimeRulerProps) {
  // Default to 5 minutes when no audio is loaded
  const totalMs = duration > 0 ? duration : 300000;
  const visibleMs = totalMs / zoomLevel;
  const startMs = scrollOffset;

  const ticks = useMemo(() => {
    const result: Array<{ sec: number; label: string; x: number }> = [];
    const pxPerSec = 800 / (visibleMs / 1000);
    let stepSec = 1;
    if (pxPerSec < 15) stepSec = 30;
    else if (pxPerSec < 30) stepSec = 10;
    else if (pxPerSec < 60) stepSec = 5;
    else if (pxPerSec < 120) stepSec = 2;

    const startSec = Math.floor(startMs / 1000 / stepSec) * stepSec;
    const endSec = Math.ceil((startMs + visibleMs) / 1000);
    for (let s = startSec; s <= endSec; s += stepSec) {
      const x = ((s * 1000 - startMs) / visibleMs) * 100;
      if (x < -5 || x > 105) continue;
      const min = Math.floor(s / 60);
      const sec = s % 60;
      result.push({ sec: s, label: `${min}:${String(sec).padStart(2, '0')}`, x });
    }
    return result;
  }, [visibleMs, startMs]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = x / rect.width;
    const timeMs = startMs + ratio * visibleMs;
    onSeek(timeMs);
  }, [onSeek, startMs, visibleMs]);

  return (
    <div
      style={{
        height: '24px', background: 'var(--surface-soft)', position: 'relative',
        borderBottom: '1px solid var(--hairline)', overflow: 'hidden', cursor: 'pointer',
        width: '100%',
      }}
      onClick={handleClick}
    >
      {ticks.map((t) => (
        <div key={t.sec} style={{
          position: 'absolute', left: `${t.x}%`, top: 0, height: '100%',
          borderLeft: '1px solid var(--hairline-strong)',
        }}>
          <span style={{
            position: 'absolute', left: '4px', top: '2px',
            fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--mute)',
            whiteSpace: 'nowrap',
          }}>{t.label}</span>
        </div>
      ))}
    </div>
  );
}
