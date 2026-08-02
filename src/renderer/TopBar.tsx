import { useEffect, useRef, useState } from 'react';

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

const VIEW_META: Record<
  ViewType,
  { label: string; title: string; icon: string }
> = {
  project: { label: '项目', title: '项目管理', icon: 'mdi-file-document' },
  editor: { label: '歌词', title: '歌词编辑', icon: 'mdi-pencil' },
  timing: { label: '打轴', title: '音乐打轴', icon: 'mdi-timer' },
  resources: { label: '设置', title: '资源配置', icon: 'mdi-cog-outline' },
};

const DRAG_THRESHOLD = 5; // px of pointer travel before it counts as a drag

export default function TopBar({
  currentView,
  onViewChange,
  hasProject,
  onExit,
}: TopBarProps) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [dragging, setDragging] = useState(false);
  // horizontal pan when tabs overflow: dragging moves scrollLeft (no scrollbar)
  const tabsRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{
    pointerId: number;
    startX: number;
    startScrollLeft: number;
    moved: boolean;
  } | null>(null);
  // survives pointerup so onClick can tell whether a drag just happened
  const justDragged = useRef(false);

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

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    const el = tabsRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return; // nothing to pan
    dragState.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startScrollLeft: el.scrollLeft,
      moved: false,
    };
    el.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const st = dragState.current;
    const el = tabsRef.current;
    if (!st || !el || st.pointerId !== e.pointerId) return;
    const dx = e.clientX - st.startX;
    if (!st.moved && Math.abs(dx) > DRAG_THRESHOLD) {
      st.moved = true;
    }
    if (st.moved) {
      el.scrollLeft = st.startScrollLeft - dx;
      justDragged.current = true;
    }
    setDragging(st.moved);
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    const st = dragState.current;
    if (!st || st.pointerId !== e.pointerId) return;
    dragState.current = null;
    setDragging(false);
    const el = tabsRef.current;
    el?.releasePointerCapture?.(e.pointerId);
  };

  const onTabClick = (view: ViewType): void => {
    if (justDragged.current) {
      justDragged.current = false; // consume: this click was the drag end
      return;
    }
    onViewChange(view);
  };

  return (
    <div className="topbar" style={{ WebkitAppRegion: 'drag' }}>
      <span className="topbar-brand">Necokara</span>
      <div
        ref={tabsRef}
        className={`topbar-tabs${dragging ? ' topbar-tabs-dragging' : ''}`}
        style={{ WebkitAppRegion: 'no-drag' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {(['project', 'editor', 'timing', 'resources'] as ViewType[]).map(
          (view) => {
            const disabled =
              !hasProject && view !== 'project' && view !== 'resources';
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
                  if (!disabled) onTabClick(view);
                }}
              >
                <span className={`mdi ${VIEW_META[view].icon}`} />
                {VIEW_META[view].label}
              </button>
            );
          },
        )}
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
