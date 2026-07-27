import { Toolbar, ToolbarSep } from '../../shared/components/Toolbar';

interface ProjectToolbarProps {
  hasProject: boolean;
  hasUserPassword: boolean;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onClose: () => void;
  onSetPassword: () => void;
  onClearPassword: () => void;
}

export default function ProjectToolbar({
  hasProject,
  hasUserPassword,
  onNew,
  onOpen,
  onSave,
  onSaveAs,
  onClose,
  onSetPassword,
  onClearPassword,
}: ProjectToolbarProps) {
  return (
    <Toolbar>
      <button type="button" className="shared-btn" onClick={onNew}>
        <span className="mdi mdi-file-plus" /> 新建
      </button>
      <button type="button" className="shared-btn" onClick={onOpen}>
        <span className="mdi mdi-folder-open" /> 打开
      </button>
      <ToolbarSep />
      <button
        type="button"
        className="shared-btn"
        onClick={onSave}
        disabled={!hasProject}
      >
        <span className="mdi mdi-content-save" /> 保存
      </button>
      <button
        type="button"
        className="shared-btn"
        onClick={onSaveAs}
        disabled={!hasProject}
      >
        <span className="mdi mdi-content-save-outline" /> 另存为
      </button>
      <ToolbarSep />
      <button
        type="button"
        className="shared-btn"
        onClick={onClose}
        disabled={!hasProject}
      >
        <span className="mdi mdi-close-box" /> 关闭
      </button>
      <ToolbarSep />
      <button
        type="button"
        className="shared-btn"
        onClick={onSetPassword}
        disabled={!hasProject}
      >
        <span className="mdi mdi-lock" />{' '}
        {hasUserPassword ? '更改密码' : '设置密码'}
      </button>
      <button
        type="button"
        className="shared-btn"
        onClick={onClearPassword}
        disabled={!hasProject}
      >
        <span className="mdi mdi-lock-off" /> 清除密码
      </button>
    </Toolbar>
  );
}
