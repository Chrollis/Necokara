import { useRef, useState } from 'react';
import type { Lyrics } from '../../editor/lyrics';
import ImportExportMenu from './ImportExportMenu';
import {
  Toolbar,
  ToolbarSep,
  ToolbarButton,
} from '../../shared/components/Toolbar';

interface EditorToolbarProps {
  lyrics: Lyrics;
  selectedCount: number;
  segmentMenuOpen: boolean;
  onToggleSegmentMenu: () => void;
  onEdit: () => void;
  onMerge: () => void;
  onDelete: () => void;
  onCharSegment: () => void;
  onJpSegment: (withRuby: boolean) => void;
  onImport: (imported: Lyrics) => void;
  onMetadata: () => void;
}

export default function EditorToolbar({
  lyrics,
  selectedCount,
  segmentMenuOpen,
  onToggleSegmentMenu,
  onEdit,
  onMerge,
  onDelete,
  onCharSegment,
  onJpSegment,
  onImport,
  onMetadata,
}: EditorToolbarProps) {
  const segBtnRef = useRef<HTMLButtonElement>(null);
  const [segBtnRect, setSegBtnRect] = useState<DOMRect | null>(null);

  return (
    <>
      <Toolbar>
        <ImportExportMenu lyrics={lyrics} onImport={onImport} />
        <ToolbarSep />
        <ToolbarButton
          icon="pencil"
          onClick={onEdit}
          disabled={selectedCount === 0}
          title={selectedCount === 0 ? '选取为空' : undefined}
        >
          编辑
        </ToolbarButton>
        <ToolbarButton
          icon="call-merge"
          onClick={onMerge}
          disabled={selectedCount < 2}
          title={selectedCount < 2 ? '需选中至少 2 个词' : undefined}
        >
          合并
        </ToolbarButton>
        <ToolbarButton
          icon="delete"
          onClick={onDelete}
          disabled={selectedCount === 0}
          title={selectedCount === 0 ? '选取为空' : undefined}
        >
          删除
        </ToolbarButton>
        <ToolbarSep />
        <button
          ref={segBtnRef}
          type="button"
          className="shared-btn"
          disabled={selectedCount === 0}
          onClick={() => {
            setSegBtnRect(segBtnRef.current?.getBoundingClientRect() ?? null);
            onToggleSegmentMenu();
          }}
          title={selectedCount === 0 ? '选取为空' : undefined}
        >
          <span className="mdi mdi-file-tree" /> 分词
        </button>
        <ToolbarSep />
        <ToolbarButton icon="tag-text" onClick={onMetadata}>
          元数据
        </ToolbarButton>
        <div className="ed-toolbar-spacer" />
      </Toolbar>
      {segmentMenuOpen && selectedCount > 0 && segBtnRect && (
        <div
          className="ed-seg-menu"
          style={{
            position: 'fixed',
            left: segBtnRect.left,
            top: segBtnRect.bottom + 4,
            minWidth: segBtnRect.width,
          }}
        >
          <button type="button" className="ed-seg-item" onClick={onCharSegment}>
            逐字符分词
          </button>
          <button
            type="button"
            className="ed-seg-item"
            onClick={() => onJpSegment(false)}
          >
            日语分词
          </button>
          <button
            type="button"
            className="ed-seg-item"
            onClick={() => onJpSegment(true)}
          >
            日语分词注音
          </button>
        </div>
      )}
    </>
  );
}
