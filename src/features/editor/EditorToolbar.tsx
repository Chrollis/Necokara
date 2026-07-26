import type { Lyrics } from '../../editor/lyrics';
import ImportExportMenu from './ImportExportMenu';

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
}

export default function EditorToolbar({
  lyrics, selectedCount,
  segmentMenuOpen, onToggleSegmentMenu,
  onEdit, onMerge, onDelete,
  onCharSegment, onJpSegment,
  onImport,
}: EditorToolbarProps) {

  return (
    <div className="ed-toolbar">
      <ImportExportMenu lyrics={lyrics} onImport={onImport} />
      <div className="ed-toolbar-sep" />
      <button
        type="button"
        className="ed-btn"
        disabled={selectedCount === 0}
        onClick={onEdit}
        title={selectedCount === 0 ? '选取为空' : undefined}
      >
        <span className="mdi mdi-pencil" /> 编辑
      </button>
      <button
        type="button"
        className="ed-btn"
        disabled={selectedCount < 2}
        onClick={onMerge}
        title={selectedCount < 2 ? '需选中至少 2 个词' : undefined}
      >
        <span className="mdi mdi-call-merge" /> 合并
      </button>
      <button
        type="button"
        className="ed-btn"
        disabled={selectedCount === 0}
        onClick={onDelete}
        title={selectedCount === 0 ? '选取为空' : undefined}
      >
        <span className="mdi mdi-delete" /> 删除
      </button>
      <div className="ed-toolbar-sep" />
      <div className="ed-seg-root">
        <button
          type="button"
          className="ed-btn"
          disabled={selectedCount === 0}
          onClick={onToggleSegmentMenu}
          title={selectedCount === 0 ? '选取为空' : undefined}
        >
          <span className="mdi mdi-file-tree" /> 分词
        </button>
        {segmentMenuOpen && selectedCount > 0 && (
          <div className="ed-seg-menu">
            <button type="button" className="ed-seg-item" onClick={onCharSegment}>
              逐字符分词
            </button>
            <button type="button" className="ed-seg-item" onClick={() => onJpSegment(false)}>
              日语分词
            </button>
            <button type="button" className="ed-seg-item" onClick={() => onJpSegment(true)}>
              日语分词注音
            </button>
          </div>
        )}
      </div>
      <div className="ed-toolbar-spacer" />
    </div>
  );
}
