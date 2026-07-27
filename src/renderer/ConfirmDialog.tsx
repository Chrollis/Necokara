import { useRef } from 'react';
import { useClickOutside } from '../shared/hooks/useClickOutside';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  extraLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  onExtra?: () => void;
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = '确定',
  cancelLabel = '取消',
  extraLabel,
  onConfirm,
  onCancel,
  onExtra,
}: ConfirmDialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  useClickOutside(overlayRef, true, onCancel);

  return (
    <div className="rem-overlay" ref={overlayRef}>
      <div
        className="rem-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ minWidth: '320px' }}
      >
        <div className="rem-header">
          <span className="rem-title">{title}</span>
          <button type="button" className="rem-close" onClick={onCancel}>
            <span className="mdi mdi-close" />
          </button>
        </div>
        <div
          className="rem-body"
          style={{ fontSize: '14px', color: 'var(--ink)' }}
        >
          {message}
        </div>
        <div className="rem-footer">
          <button
            type="button"
            className="shared-btn shared-btn-primary"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
          {extraLabel && onExtra && (
            <button type="button" className="shared-btn" onClick={onExtra}>
              {extraLabel}
            </button>
          )}
          <button type="button" className="shared-btn" onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
