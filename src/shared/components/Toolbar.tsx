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

interface ToolbarButtonProps {
  icon?: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children?: ReactNode;
}

export function ToolbarButton({
  icon,
  onClick,
  disabled,
  title,
  children,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      className="shared-btn"
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {icon && <span className={`mdi mdi-${icon}`} />}
      {children}
    </button>
  );
}
