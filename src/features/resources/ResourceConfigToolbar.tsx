import { Toolbar, ToolbarButton } from '../../shared/components/Toolbar';

interface ResourceConfigToolbarProps {
  onRefresh: () => void;
  refreshing?: boolean;
}

export default function ResourceConfigToolbar({
  onRefresh,
  refreshing,
}: ResourceConfigToolbarProps) {
  return (
    <Toolbar>
      <ToolbarButton
        icon="refresh"
        onClick={onRefresh}
        loading={refreshing}
        title="重新扫描模型目录并校验 ffmpeg"
      >
        刷新
      </ToolbarButton>
    </Toolbar>
  );
}
