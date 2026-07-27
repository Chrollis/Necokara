import { useState, useRef } from 'react';
import { Project } from '../../project/project';

export type PwDialogMode =
  'set' | 'change' | 'enter' | 'askSet' | 'askChange' | 'clear';

export interface ConfirmDialogState {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  extraLabel?: string;
  onConfirm: () => void;
  onCancel?: () => void;
  onExtra?: () => void;
}

export default function useDialogs() {
  const [pwDialog, setPwDialog] = useState<{ mode: PwDialogMode } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(
    null,
  );
  const pendingPwActionRef = useRef<'save' | 'saveAs'>('save');
  const pendingOpenPathRef = useRef<string | null>(null);

  return {
    pwDialog,
    setPwDialog,
    confirmDialog,
    setConfirmDialog,
    pendingPwActionRef,
    pendingOpenPathRef,
  };
}
