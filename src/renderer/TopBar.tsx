type ViewType = 'project' | 'editor' | 'timing';

interface TopBarProps {
  currentView: ViewType;
  onViewChange: (view: ViewType) => void;
  hasProject: boolean;
  onExit: () => void;
}

export default function TopBar({
  currentView,
  onViewChange,
  hasProject,
  onExit,
}: TopBarProps) {
  return (
    <div className="topbar" style={{ WebkitAppRegion: 'drag' as any }}>
      <span className="topbar-brand">Necokara</span>
      <div
        className="topbar-tabs"
        style={{ WebkitAppRegion: 'no-drag' as any }}
      >
        {(['project', 'editor', 'timing'] as const).map((view) => {
          const disabled = !hasProject && view !== 'project';
          return (
            <button
              key={view}
              type="button"
              disabled={disabled}
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
              <span
                className={`mdi ${view === 'project' ? 'mdi-file-document' : view === 'editor' ? 'mdi-pencil' : 'mdi-timer'}`}
              />
              {view === 'project'
                ? '项目管理'
                : view === 'editor'
                  ? '歌词编辑'
                  : '音乐打轴'}
            </button>
          );
        })}
      </div>
      <div
        className="topbar-window-controls"
        style={{ WebkitAppRegion: 'no-drag' as any }}
      >
        <button
          type="button"
          className="topbar-win-btn"
          onClick={() => window.electron.window.minimize()}
        >
          <span className="mdi mdi-window-minimize" />
        </button>
        <button
          type="button"
          className="topbar-win-btn"
          onClick={() => window.electron.window.maximize()}
        >
          <span className="mdi mdi-window-maximize" />
        </button>
        <button
          type="button"
          className="topbar-win-btn topbar-win-close"
          onClick={onExit}
        >
          <span className="mdi mdi-close" />
        </button>
      </div>
    </div>
  );
}
