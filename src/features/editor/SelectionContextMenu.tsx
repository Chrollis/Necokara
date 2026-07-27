import {
  ContextMenuContainer,
  ContextMenuItem,
  ContextMenuSep,
} from '../../shared/components/ContextMenu';

interface SelectionContextMenuProps {
  x: number;
  y: number;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  hasMultipleSelection: boolean;
  onClose: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onEditSelection: () => void;
  onDeleteSelection: () => void;
  onMergeSelection: () => void;
  onSegment: () => void;
}

export default function SelectionContextMenu({
  x,
  y,
  canUndo,
  canRedo,
  hasSelection,
  hasMultipleSelection,
  onClose,
  onUndo,
  onRedo,
  onEditSelection,
  onDeleteSelection,
  onMergeSelection,
  onSegment,
}: SelectionContextMenuProps) {
  return (
    <ContextMenuContainer x={x} y={y} onClose={onClose}>
      <ContextMenuItem
        onClick={() => {
          onUndo();
          onClose();
        }}
        disabled={!canUndo}
      >
        撤销
      </ContextMenuItem>
      <ContextMenuItem
        onClick={() => {
          onRedo();
          onClose();
        }}
        disabled={!canRedo}
      >
        重做
      </ContextMenuItem>
      <ContextMenuSep />
      <ContextMenuItem
        onClick={() => {
          onEditSelection();
          onClose();
        }}
        disabled={!hasSelection}
      >
        编辑选区
      </ContextMenuItem>
      <ContextMenuItem
        onClick={() => {
          onDeleteSelection();
          onClose();
        }}
        disabled={!hasSelection}
      >
        删除选区
      </ContextMenuItem>
      <ContextMenuItem
        onClick={() => {
          onMergeSelection();
          onClose();
        }}
        disabled={!hasMultipleSelection}
      >
        合并选区
      </ContextMenuItem>
      <ContextMenuSep />
      <ContextMenuItem
        onClick={() => {
          onSegment();
          onClose();
        }}
        disabled={!hasSelection}
      >
        分词
      </ContextMenuItem>
    </ContextMenuContainer>
  );
}
