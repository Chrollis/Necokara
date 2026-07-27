import type { ReactNode } from 'react';

export function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div className="shared-toolbar">
      <div className="shared-toolbar-scroll">{children}</div>
    </div>
  );
}

export function ToolbarSep() {
  return <div className="shared-toolbar-sep" />;
}
