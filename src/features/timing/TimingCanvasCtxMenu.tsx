import { useRef } from 'react';
import { useClickOutside } from '../../shared/hooks/useClickOutside';

interface TimingCanvasCtxMenuProps {
  x: number;
  y: number;
  canUndo: boolean;
  canRedo: boolean;
  audioEngine: boolean;
  isPlaying: boolean;
  onClose: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onTogglePlay: () => void;
  onSeekStart: () => void;
  onSeekEnd: () => void;
  onNextBeat: () => void;
  onPrevBeat: () => void;
}

export default function TimingCanvasCtxMenu({
  x, y, canUndo, canRedo, audioEngine, isPlaying,
  onClose, onUndo, onRedo, onTogglePlay, onSeekStart, onSeekEnd, onNextBeat, onPrevBeat,
}: TimingCanvasCtxMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, true, onClose);

  return (
    <div ref={ref} className="shared-ctx-menu" style={{ position: 'fixed', left: x, top: y, zIndex: 1000 }}>
      <button className="shared-ctx-item" onClick={onUndo} disabled={!canUndo}>撤销</button>
      <button className="shared-ctx-item" onClick={onRedo} disabled={!canRedo}>重做</button>
      <div className="shared-ctx-sep" />
      <button className="shared-ctx-item" onClick={onTogglePlay} disabled={!audioEngine}>{isPlaying ? '暂停' : '播放'}</button>
      <button className="shared-ctx-item" onClick={onSeekStart} disabled={!audioEngine}>到开始</button>
      <button className="shared-ctx-item" onClick={onSeekEnd} disabled={!audioEngine}>到结尾</button>
      <div className="shared-ctx-sep" />
      <button className="shared-ctx-item" onClick={onNextBeat}>前进一格</button>
      <button className="shared-ctx-item" onClick={onPrevBeat}>后退一格</button>
    </div>
  );
}
