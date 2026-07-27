import { useRef } from 'react';
import { useClickOutside } from '../../shared/hooks/useClickOutside';

interface TimingCardCtxMenuProps {
  x: number;
  y: number;
  isSet: boolean;
  audioEngine: boolean;
  onClose: () => void;
  onReset: () => void;
  onShift: (delta: number) => void;
  onPlayFrom: () => void;
  onSeek: () => void;
}

export default function TimingCardCtxMenu({
  x, y, isSet, audioEngine,
  onClose, onReset, onShift, onPlayFrom, onSeek,
}: TimingCardCtxMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, true, onClose);

  return (
    <div ref={ref} className="shared-ctx-menu" style={{ position: 'fixed', left: x, top: y, zIndex: 1000 }}>
      <button className="shared-ctx-item" onClick={onReset} disabled={!isSet}>重置时间</button>
      <div className="shared-ctx-sep" />
      <button className="shared-ctx-item" onClick={() => onShift(-10)} disabled={!isSet}>前移10ms</button>
      <button className="shared-ctx-item" onClick={() => onShift(10)} disabled={!isSet}>后移10ms</button>
      <div className="shared-ctx-sep" />
      <button className="shared-ctx-item" onClick={onPlayFrom} disabled={!audioEngine || !isSet}>从该单词开始播放</button>
      <button className="shared-ctx-item" onClick={onSeek} disabled={!audioEngine || !isSet}>转到该单词的位置</button>
    </div>
  );
}
