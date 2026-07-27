import { useRef, type ReactNode } from 'react';
import { useClickOutside } from '../hooks/useClickOutside';

interface ContextMenuContainerProps {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
}

export function ContextMenuContainer({
  x,
  y,
  onClose,
  children,
}: ContextMenuContainerProps) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, true, onClose);

  return (
    <div
      ref={ref}
      className="shared-ctx-menu"
      style={{ position: 'fixed', left: x, top: y, zIndex: 1000 }}
    >
      {children}
    </div>
  );
}

interface ContextMenuItemProps {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}

export function ContextMenuItem({
  onClick,
  disabled,
  children,
}: ContextMenuItemProps) {
  return (
    <button className="shared-ctx-item" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function ContextMenuSep() {
  return <div className="shared-ctx-sep" />;
}
