import {
  ContextMenuContainer,
  ContextMenuItem,
  ContextMenuSep,
} from '../../shared/components/ContextMenu';

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
  x,
  y,
  isSet,
  audioEngine,
  onClose,
  onReset,
  onShift,
  onPlayFrom,
  onSeek,
}: TimingCardCtxMenuProps) {
  return (
    <ContextMenuContainer x={x} y={y} onClose={onClose}>
      <ContextMenuItem onClick={onReset} disabled={!isSet}>
        重置时间
      </ContextMenuItem>
      <ContextMenuSep />
      <ContextMenuItem onClick={() => onShift(-10)} disabled={!isSet}>
        前移10ms
      </ContextMenuItem>
      <ContextMenuItem onClick={() => onShift(10)} disabled={!isSet}>
        后移10ms
      </ContextMenuItem>
      <ContextMenuSep />
      <ContextMenuItem onClick={onPlayFrom} disabled={!audioEngine || !isSet}>
        从该单词开始播放
      </ContextMenuItem>
      <ContextMenuItem onClick={onSeek} disabled={!audioEngine || !isSet}>
        转到该单词的位置
      </ContextMenuItem>
    </ContextMenuContainer>
  );
}
