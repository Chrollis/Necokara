import { useRef } from 'react';
import { useClickOutside } from '../../shared/hooks/useClickOutside';

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
  x, y,
  canUndo, canRedo,
  hasSelection, hasMultipleSelection,
  onClose,
  onUndo, onRedo,
  onEditSelection, onDeleteSelection,
  onMergeSelection, onSegment,
}: SelectionContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, true, onClose);

  return (
    <div className="shared-ctx-menu" ref={ref} style={{ left: x, top: y }}>
      <button
        type="button"
        className="shared-ctx-item"
        disabled={!canUndo}
        onClick={() => { onUndo(); onClose(); }}
      >
        撤销
      </button>
      <button
        type="button"
        className="shared-ctx-item"
        disabled={!canRedo}
        onClick={() => { onRedo(); onClose(); }}
      >
        重做
      </button>
      <div className="shared-ctx-sep" />
      <button
        type="button"
        className="shared-ctx-item"
        disabled={!hasSelection}
        onClick={() => { onEditSelection(); onClose(); }}
      >
        编辑选区
      </button>
      <button
        type="button"
        className="shared-ctx-item"
        disabled={!hasSelection}
        onClick={() => { onDeleteSelection(); onClose(); }}
      >
        删除选区
      </button>
      <button
        type="button"
        className="shared-ctx-item"
        disabled={!hasMultipleSelection}
        onClick={() => { onMergeSelection(); onClose(); }}
      >
        合并选区
      </button>
      <button
        type="button"
        className="shared-ctx-item"
        disabled={!hasSelection}
        onClick={() => { onSegment(); onClose(); }}
      >
        分词
      </button>
    </div>
  );
}
