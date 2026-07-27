import { useRef, useState } from 'react';
import type { Lyrics } from '../../editor/lyrics';
import ImportExportMenu from './ImportExportMenu';
import { Toolbar, ToolbarSep } from '../../shared/components/Toolbar';

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
        <button
          type="button"
          className="shared-btn"
          disabled={selectedCount === 0}
          onClick={onEdit}
          title={selectedCount === 0 ? '选取为空' : undefined}
        >
          <span className="mdi mdi-pencil" /> 编辑
        </button>
        <button
          type="button"
          className="shared-btn"
          disabled={selectedCount < 2}
          onClick={onMerge}
          title={selectedCount < 2 ? '需选中至少 2 个词' : undefined}
        >
          <span className="mdi mdi-call-merge" /> 合并
        </button>
        <button
          type="button"
          className="shared-btn"
          disabled={selectedCount === 0}
          onClick={onDelete}
          title={selectedCount === 0 ? '选取为空' : undefined}
        >
          <span className="mdi mdi-delete" /> 删除
        </button>
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
        <button type="button" className="shared-btn" onClick={onMetadata}>
          <span className="mdi mdi-tag-text" /> 元数据
        </button>
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
