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
  loading?: boolean;
  progress?: number; // 0–1, or -1 for indeterminate spinner
  title?: string;
  children?: ReactNode;
}

const R = 8;
const CIR = 2 * Math.PI * R;

function SpinnerSVG() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      style={{ verticalAlign: 'middle', flexShrink: 0 }}
      className="tv-spinner"
    >
      <circle
        cx="10"
        cy="10"
        r={R}
        fill="none"
        stroke="var(--hairline-strong)"
        strokeWidth="2"
      />
      <circle
        cx="10"
        cy="10"
        r={R}
        fill="none"
        stroke="var(--ink)"
        strokeWidth="2"
        strokeDasharray={CIR * 0.65}
        strokeDashoffset={CIR * 0.15}
        strokeLinecap="round"
      />
    </svg>
  );
}

function ProgressSVG({ pct }: { pct: number }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      style={{ verticalAlign: 'middle', flexShrink: 0 }}
    >
      <circle
        cx="10"
        cy="10"
        r={R}
        fill="none"
        stroke="var(--hairline-strong)"
        strokeWidth="2"
      />
      <circle
        cx="10"
        cy="10"
        r={R}
        fill="none"
        stroke="var(--ink)"
        strokeWidth="2"
        strokeDasharray={CIR}
        strokeDashoffset={CIR * (1 - Math.max(0, Math.min(1, pct / 100)))}
        strokeLinecap="round"
        transform="rotate(-90 10 10)"
      />
    </svg>
  );
}

export function ToolbarButton({
  icon,
  onClick,
  disabled,
  loading,
  progress,
  title,
  children,
}: ToolbarButtonProps) {
  const isBusy = loading || (progress != null && progress >= 0);
  return (
    <button
      type="button"
      className={`shared-btn${isBusy ? ' tv-loading' : ''}`}
      onClick={onClick}
      disabled={disabled || isBusy}
      title={title}
    >
      {loading && progress == null ? (
        <SpinnerSVG />
      ) : progress != null && progress >= 0 ? (
        <ProgressSVG pct={progress * 100} />
      ) : (
        icon && <span className={`mdi mdi-${icon}`} />
      )}
      {children}
    </button>
  );
}
