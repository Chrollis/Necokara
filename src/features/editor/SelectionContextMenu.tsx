import { useEffect, useRef } from 'react';

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

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div className="ed-context-menu" ref={ref} style={{ left: x, top: y }}>
      <button
        type="button"
        className={['ed-context-item', !canUndo ? 'ed-context-item-disabled' : ''].filter(Boolean).join(' ')}
        disabled={!canUndo}
        onClick={() => { onUndo(); onClose(); }}
      >
        撤销
      </button>
      <button
        type="button"
        className={['ed-context-item', !canRedo ? 'ed-context-item-disabled' : ''].filter(Boolean).join(' ')}
        disabled={!canRedo}
        onClick={() => { onRedo(); onClose(); }}
      >
        重做
      </button>
      <div className="ed-context-separator" />
      <button
        type="button"
        className={['ed-context-item', !hasSelection ? 'ed-context-item-disabled' : ''].filter(Boolean).join(' ')}
        disabled={!hasSelection}
        onClick={() => { onEditSelection(); onClose(); }}
      >
        编辑选区
      </button>
      <button
        type="button"
        className={['ed-context-item', !hasSelection ? 'ed-context-item-disabled' : ''].filter(Boolean).join(' ')}
        disabled={!hasSelection}
        onClick={() => { onDeleteSelection(); onClose(); }}
      >
        删除选区
      </button>
      <button
        type="button"
        className={['ed-context-item', !hasMultipleSelection ? 'ed-context-item-disabled' : ''].filter(Boolean).join(' ')}
        disabled={!hasMultipleSelection}
        onClick={() => { onMergeSelection(); onClose(); }}
      >
        合并选区
      </button>
      <button
        type="button"
        className={['ed-context-item', !hasSelection ? 'ed-context-item-disabled' : ''].filter(Boolean).join(' ')}
        disabled={!hasSelection}
        onClick={() => { onSegment(); onClose(); }}
      >
        分词
      </button>
    </div>
  );
}
