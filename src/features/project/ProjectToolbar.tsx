import {
  Toolbar,
  ToolbarSep,
  ToolbarButton,
} from '../../shared/components/Toolbar';

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
      <ToolbarButton icon="file-plus" onClick={onNew}>
        新建
      </ToolbarButton>
      <ToolbarButton icon="folder-open" onClick={onOpen}>
        打开
      </ToolbarButton>
      <ToolbarSep />
      <ToolbarButton
        icon="content-save"
        onClick={onSave}
        disabled={!hasProject}
      >
        保存
      </ToolbarButton>
      <ToolbarButton
        icon="content-save-outline"
        onClick={onSaveAs}
        disabled={!hasProject}
      >
        另存为
      </ToolbarButton>
      <ToolbarSep />
      <ToolbarButton icon="close-box" onClick={onClose} disabled={!hasProject}>
        关闭
      </ToolbarButton>
      <ToolbarSep />
      <ToolbarButton icon="lock" onClick={onSetPassword} disabled={!hasProject}>
        {hasUserPassword ? '更改密码' : '设置密码'}
      </ToolbarButton>
      <ToolbarButton
        icon="lock-off"
        onClick={onClearPassword}
        disabled={!hasProject || !hasUserPassword}
      >
        清除密码
      </ToolbarButton>
    </Toolbar>
  );
}
