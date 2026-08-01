import { useEffect, useState } from 'react';

type ViewType = 'project' | 'editor' | 'timing' | 'resources';

interface TopBarProps {
  currentView: ViewType;
  onViewChange: (view: ViewType) => void;
  hasProject: boolean;
  onExit: () => void;
}

// WebkitAppRegion is a Chromium/Electron CSS property not in React's CSSProperties
declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag';
  }
}

const VIEW_META: Record<ViewType, { label: string; title: string; icon: string }> = {
  project: { label: '项目', title: '项目管理', icon: 'mdi-file-document' },
  editor: { label: '歌词', title: '歌词编辑', icon: 'mdi-pencil' },
  timing: { label: '打轴', title: '音乐打轴', icon: 'mdi-timer' },
  resources: { label: '设置', title: '资源配置', icon: 'mdi-cog-outline' },
};

export default function TopBar({
  currentView,
  onViewChange,
  hasProject,
  onExit,
}: TopBarProps) {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.electron.window.isMaximized().then((v) => {
      if (!cancelled) setIsMaximized(!!v);
    });
    const unsub = window.electron.window.onMaximizedChange((v) => {
      setIsMaximized(v);
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  return (
    <div className="topbar" style={{ WebkitAppRegion: 'drag' }}>
      <span className="topbar-brand">Necokara</span>
      <div className="topbar-tabs" style={{ WebkitAppRegion: 'no-drag' }}>
        {(
          [
            'project',
            'editor',
            'timing',
            'resources',
          ] as ViewType[]
        ).map((view) => {
          const disabled = !hasProject && view !== 'project' && view !== 'resources';
          return (
            <button
              key={view}
              type="button"
              disabled={disabled}
              title={VIEW_META[view].title}
              className={[
                'topbar-tab',
                currentView === view ? 'topbar-tab-active' : '',
                disabled ? 'topbar-tab-disabled' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => {
                if (!disabled) onViewChange(view);
              }}
            >
              <span className={`mdi ${VIEW_META[view].icon}`} />
              {VIEW_META[view].label}
            </button>
          );
        })}
      </div>
      <div
        className="topbar-window-controls"
        style={{ WebkitAppRegion: 'no-drag' }}
      >
        <button
          type="button"
          className="topbar-win-btn"
          title="最小化"
          onClick={() => window.electron.window.minimize()}
        >
          <span className="mdi mdi-window-minimize" />
        </button>
        <button
          type="button"
          className="topbar-win-btn"
          title={isMaximized ? '还原' : '最大化'}
          onClick={() => window.electron.window.maximize()}
        >
          <span
            className={`mdi ${isMaximized ? 'mdi-window-restore' : 'mdi-window-maximize'}`}
          />
        </button>
        <button
          type="button"
          className="topbar-win-btn topbar-win-close"
          title="关闭"
          onClick={onExit}
        >
          <span className="mdi mdi-close" />
        </button>
      </div>
    </div>
  );
}
