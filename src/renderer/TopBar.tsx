interface TopBarProps {
  currentView: 'editor' | 'timing';
  onViewChange: (view: 'editor' | 'timing') => void;
}

export default function TopBar({ currentView, onViewChange }: TopBarProps) {
  return (
    <div className="topbar">
      <span className="topbar-brand">Necokara</span>
      <div className="topbar-tabs">
        <button
          type="button"
          className={['topbar-tab', currentView === 'editor' ? 'topbar-tab-active' : ''].filter(Boolean).join(' ')}
          onClick={() => onViewChange('editor')}
        >
          <span className="mdi mdi-pencil" />
          歌词编辑
        </button>
        <button
          type="button"
          className={['topbar-tab', currentView === 'timing' ? 'topbar-tab-active' : ''].filter(Boolean).join(' ')}
          onClick={() => onViewChange('timing')}
        >
          <span className="mdi mdi-timer" />
          音乐打轴
        </button>
      </div>
    </div>
  );
}
