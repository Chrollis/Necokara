import {
  ContextMenuContainer,
  ContextMenuItem,
  ContextMenuSep,
} from '../../shared/components/ContextMenu';

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
  x,
  y,
  canUndo,
  canRedo,
  audioEngine,
  isPlaying,
  onClose,
  onUndo,
  onRedo,
  onTogglePlay,
  onSeekStart,
  onSeekEnd,
  onNextBeat,
  onPrevBeat,
}: TimingCanvasCtxMenuProps) {
  return (
    <ContextMenuContainer x={x} y={y} onClose={onClose}>
      <ContextMenuItem onClick={onUndo} disabled={!canUndo}>
        撤销
      </ContextMenuItem>
      <ContextMenuItem onClick={onRedo} disabled={!canRedo}>
        重做
      </ContextMenuItem>
      <ContextMenuSep />
      <ContextMenuItem onClick={onTogglePlay} disabled={!audioEngine}>
        {isPlaying ? '暂停' : '播放'}
      </ContextMenuItem>
      <ContextMenuItem onClick={onSeekStart} disabled={!audioEngine}>
        到开始
      </ContextMenuItem>
      <ContextMenuItem onClick={onSeekEnd} disabled={!audioEngine}>
        到结尾
      </ContextMenuItem>
      <ContextMenuSep />
      <ContextMenuItem onClick={onNextBeat}>前进一格</ContextMenuItem>
      <ContextMenuItem onClick={onPrevBeat}>后退一格</ContextMenuItem>
    </ContextMenuContainer>
  );
}
