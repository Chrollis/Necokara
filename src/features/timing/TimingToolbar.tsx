import { useState, useRef, useCallback } from 'react';
import type AudioEngine from './AudioEngine';

interface TimingToolbarProps {
  audioEngine: AudioEngine | null;
  audioDuration: number;
  audioFileName: string;
  isPlaying: boolean;
  zoomLevel: number;
  currentTimeRef: React.MutableRefObject<number>;
  compensationMs: number;
  speed: number;
  multiLine: boolean;
  timelineView: boolean;
  snack?: { show: (msg: string, durationMs?: number) => void };
  onTogglePlay: () => void;
  onSeek: (timeMs: number) => void;
  onChangeCompensation: (ms: number) => void;
  onChangeSpeed: (speed: number) => void;
  snapToGrid?: boolean;
  onToggleMultiLine: () => void;
  onToggleTimelineView: () => void;
  onToggleSnap?: () => void;
  onImportAudio: () => void;
}

export default function TimingToolbar({
  audioEngine,
  audioDuration,
  audioFileName,
  isPlaying,
  zoomLevel,
  currentTimeRef,
  compensationMs,
  speed,
  multiLine,
  timelineView,
  snapToGrid,
  snack,
  onTogglePlay,
  onSeek,
  onChangeCompensation,
  onChangeSpeed,
  onToggleMultiLine,
  onToggleTimelineView,
  onToggleSnap,
  onImportAudio,
}: TimingToolbarProps) {
  const compInputRef = useRef<HTMLInputElement>(null);
  const speedInputRef = useRef<HTMLInputElement>(null);
  const [compInputOpen, setCompInputOpen] = useState(false);
  const [speedInputOpen, setSpeedInputOpen] = useState(false);

  const fmtSec = useCallback(
    (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`,
    [],
  );

  const handleCompKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter') setCompInputOpen(false);
  }, []);

  const [compBtnRect, setCompBtnRect] = useState<DOMRect | null>(null);
  const [speedBtnRect, setSpeedBtnRect] = useState<DOMRect | null>(null);
  const compBtnRef = useRef<HTMLButtonElement>(null);
  const speedBtnRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="shared-toolbar">
      <div className="shared-toolbar-scroll">
        <button type="button" className="shared-btn" onClick={onImportAudio}>
          <span className="mdi mdi-music" /> {audioFileName || '导入音频'}
        </button>
        <div className="shared-toolbar-sep" />
        <button
          type="button"
          className="shared-btn"
          disabled={!audioEngine}
          onClick={() => onSeek(0)}
        >
          <span className="mdi mdi-skip-previous" />
        </button>
        <button
          type="button"
          className="shared-btn"
          disabled={!audioEngine}
          onClick={onTogglePlay}
        >
          <span className={`mdi ${isPlaying ? 'mdi-stop' : 'mdi-play'}`} />
        </button>
        <button
          type="button"
          className="shared-btn"
          disabled={!audioEngine}
          onClick={() => onSeek(audioDuration)}
        >
          <span className="mdi mdi-skip-next" />
        </button>
        <div className="shared-toolbar-sep" />
        <button
          type="button"
          className="shared-btn"
          disabled={!audioEngine}
          onClick={() => {
            const step = audioDuration / zoomLevel / 800;
            onSeek(currentTimeRef.current - step);
          }}
        >
          <span className="mdi mdi-chevron-double-left" />
        </button>
        <button
          type="button"
          className="shared-btn"
          disabled={!audioEngine}
          onClick={() => {
            const step = audioDuration / zoomLevel / 800;
            onSeek(currentTimeRef.current + step);
          }}
        >
          <span className="mdi mdi-chevron-double-right" />
        </button>
        <div className="shared-toolbar-sep" />
        <button
          ref={compBtnRef}
          type="button"
          className="shared-btn"
          onClick={() => {
            setCompBtnRect(compBtnRef.current?.getBoundingClientRect() ?? null);
            setCompInputOpen((o) => !o);
          }}
        >
          <span className="mdi mdi-tune" /> {compensationMs >= 0 ? '+' : ''}
          {compensationMs}ms
        </button>
        <button
          ref={speedBtnRef}
          type="button"
          className="shared-btn"
          onClick={() => {
            setSpeedBtnRect(
              speedBtnRef.current?.getBoundingClientRect() ?? null,
            );
            setSpeedInputOpen((o) => !o);
          }}
        >
          <span className="mdi mdi-alpha-b-box" /> {speed.toFixed(1)}x
        </button>
        <div className="shared-toolbar-sep" />
        <button
          type="button"
          className="shared-btn"
          onClick={onToggleTimelineView}
        >
          <span
            className={`mdi ${timelineView ? 'mdi-chart-timeline-variant' : 'mdi-card-text'}`}
          />{' '}
          {timelineView ? '时间轴视图' : '卡片视图'}
        </button>
        {timelineView && (
          <button type="button" className="shared-btn" onClick={onToggleSnap}>
            <span
              className={`mdi ${snapToGrid ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline'}`}
            />{' '}
            自动吸附
          </button>
        )}
        {!timelineView && (
          <button
            type="button"
            className="shared-btn"
            onClick={onToggleMultiLine}
          >
            <span
              className={`mdi ${multiLine ? 'mdi-format-columns' : 'mdi-view-list'}`}
            />{' '}
            {multiLine ? '多行视图' : '单行视图'}
          </button>
        )}
        <span
          style={{
            fontSize: '12px',
            color: 'var(--mute)',
            flexShrink: 0,
            marginLeft: 'auto',
          }}
        >
          {audioDuration > 0
            ? `${fmtSec(Math.round(audioDuration / 1000))}`
            : '5:00'}
          {' · '}
          {(audioDuration / zoomLevel / 1000).toFixed(1)}s
        </span>
      </div>
      {compInputOpen && compBtnRect && (
        <div
          className="tv-comp-popup"
          style={{
            position: 'fixed',
            left: compBtnRect.left,
            top: compBtnRect.bottom + 4,
            width: compBtnRect.width,
          }}
        >
          <input
            ref={compInputRef}
            type="number"
            value={compensationMs}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (Number.isNaN(v)) {
                snack?.show('请输入有效数字');
                return;
              }
              onChangeCompensation(v);
            }}
            onKeyDown={handleCompKeyDown}
            style={{
              height: '32px',
              textAlign: 'center',
              fontFamily: 'var(--font-mono)',
              fontSize: '13px',
              border: '1px solid var(--hairline)',
              borderRadius: 'var(--radius-sm)',
              padding: '0 4px',
              background: 'var(--canvas)',
              color: 'var(--ink)',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <span style={{ fontSize: '11px', color: 'var(--mute)' }}>ms</span>
        </div>
      )}
      {speedInputOpen && speedBtnRect && (
        <div
          className="tv-comp-popup"
          style={{
            position: 'fixed',
            left: speedBtnRect.left,
            top: speedBtnRect.bottom + 4,
            width: speedBtnRect.width,
          }}
        >
          <input
            ref={speedInputRef}
            type="number"
            value={speed}
            step={0.1}
            min={0.1}
            max={1.0}
            onChange={(e) => {
              const raw = parseFloat(e.target.value);
              if (Number.isNaN(raw)) {
                snack?.show('请输入有效数字');
                return;
              }
              const clamped = Math.max(
                0.1,
                Math.min(1.0, Math.round(raw * 10) / 10),
              );
              onChangeSpeed(clamped);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') setSpeedInputOpen(false);
            }}
            style={{
              height: '32px',
              textAlign: 'center',
              fontFamily: 'var(--font-mono)',
              fontSize: '13px',
              border: '1px solid var(--hairline)',
              borderRadius: 'var(--radius-sm)',
              padding: '0 4px',
              background: 'var(--canvas)',
              color: 'var(--ink)',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <span style={{ fontSize: '11px', color: 'var(--mute)' }}>x</span>
        </div>
      )}
    </div>
  );
}
