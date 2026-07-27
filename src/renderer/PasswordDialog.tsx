import { useState, useRef } from 'react';
import { useClickOutside } from '../shared/hooks/useClickOutside';

interface PasswordDialogProps {
  mode: 'set' | 'change' | 'enter' | 'askSet' | 'askChange' | 'clear';
  onConfirm: (password?: string, dontAskAgain?: boolean) => void;
  onCancel: () => void;
  onYes?: (dontAsk: boolean) => void;
  snack?: { show: (msg: string) => void };
  storedPassword?: string;
}

function PwInput({
  value,
  onChange,
  placeholder,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const [show, setShow] = useState(false);
  return (
    <div
      style={{
        position: 'relative',
        flex: 1,
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <input
        ref={inputRef}
        className="rem-input"
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        onKeyDown={(e) => e.stopPropagation()}
        style={{ flex: 1, paddingRight: '32px' }}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        style={{
          position: 'absolute',
          right: '4px',
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--mute)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '24px',
          height: '24px',
          padding: 0,
        }}
        tabIndex={-1}
      >
        <span
          className={`mdi ${show ? 'mdi-eye-off' : 'mdi-eye'}`}
          style={{ fontSize: '16px' }}
        />
      </button>
    </div>
  );
}

export default function PasswordDialog({
  mode,
  onConfirm,
  onCancel,
  onYes,
  snack,
  storedPassword,
}: PasswordDialogProps) {
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [dontAsk, setDontAsk] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  useClickOutside(overlayRef, true, onCancel);

  const isAsking = mode === 'askSet' || mode === 'askChange';

  const handleNo = () => {
    onConfirm(undefined, dontAsk);
  };

  const handleSubmit = () => {
    if (mode === 'clear') {
      if (!oldPw) {
        snack?.show('请输入原密码');
        return;
      }
      if (confirmPw !== oldPw) {
        snack?.show('两次输入的密码不一致');
        return;
      }
      if (oldPw !== storedPassword) {
        snack?.show('原密码错误');
        return;
      }
      onConfirm('');
      return;
    }
    if (mode === 'enter') {
      if (!newPw) {
        snack?.show('请输入密码');
        return;
      }
      onConfirm(newPw);
      return;
    }
    if (mode === 'change' && oldPw !== storedPassword) {
      snack?.show('原密码错误');
      return;
    }
    if (!newPw) {
      snack?.show('请输入新密码');
      return;
    }
    if (newPw !== confirmPw) {
      snack?.show('两次输入的密码不一致');
      return;
    }
    onConfirm(newPw);
  };

  if (isAsking) {
    const isSet = mode === 'askSet';
    return (
      <div className="rem-overlay" ref={overlayRef}>
        <div
          className="rem-modal"
          onClick={(e) => e.stopPropagation()}
          style={{ minWidth: '320px' }}
        >
          <div className="rem-header">
            <span className="rem-title">{isSet ? '设置密码' : '更改密码'}</span>
            <button type="button" className="rem-close" onClick={onCancel}>
              <span className="mdi mdi-close" />
            </button>
          </div>
          <div className="rem-body">
            <div
              style={{
                fontSize: '14px',
                color: 'var(--ink)',
                marginBottom: 'var(--space-md)',
              }}
            >
              {isSet ? '是否为此项目设置密码？' : '是否更改此项目的密码？'}
            </div>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-xs)',
                fontSize: 'var(--font-size-sm)',
                color: 'var(--mute)',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={dontAsk}
                onChange={() => setDontAsk((v) => !v)}
              />
              此项目不再提示
            </label>
          </div>
          <div className="rem-footer">
            <button type="button" className="shared-btn" onClick={handleNo}>
              否
            </button>
            <button
              type="button"
              className="shared-btn shared-btn-primary"
              onClick={() => onYes?.(dontAsk)}
            >
              是
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rem-overlay" ref={overlayRef}>
      <div
        className="rem-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ minWidth: '360px' }}
      >
        <div className="rem-header">
          <span className="rem-title">
            {mode === 'enter'
              ? '输入密码'
              : mode === 'change'
                ? '更改密码'
                : mode === 'clear'
                  ? '清除密码'
                  : '设置密码'}
          </span>
          <button type="button" className="rem-close" onClick={onCancel}>
            <span className="mdi mdi-close" />
          </button>
        </div>
        <div className="rem-body">
          {mode === 'change' && (
            <div
              className="rem-row"
              style={{ marginBottom: 'var(--space-sm)' }}
            >
              <span className="rem-label" style={{ minWidth: '60px' }}>
                原密码
              </span>
              <PwInput value={oldPw} onChange={setOldPw} placeholder="原密码" />
            </div>
          )}
          {mode === 'clear' && (
            <>
              <div
                className="rem-row"
                style={{ marginBottom: 'var(--space-sm)' }}
              >
                <span className="rem-label" style={{ minWidth: '60px' }}>
                  原密码
                </span>
                <PwInput
                  value={oldPw}
                  onChange={setOldPw}
                  placeholder="原密码"
                />
              </div>
              <div
                className="rem-row"
                style={{ marginBottom: 'var(--space-sm)' }}
              >
                <span className="rem-label" style={{ minWidth: '60px' }}>
                  确认
                </span>
                <PwInput
                  value={confirmPw}
                  onChange={setConfirmPw}
                  placeholder="再次输入原密码"
                />
              </div>
            </>
          )}
          {mode !== 'enter' && mode !== 'clear' && (
            <div
              className="rem-row"
              style={{ marginBottom: 'var(--space-sm)' }}
            >
              <span className="rem-label" style={{ minWidth: '60px' }}>
                新密码
              </span>
              <PwInput value={newPw} onChange={setNewPw} placeholder="新密码" />
            </div>
          )}
          {mode !== 'enter' && mode !== 'clear' ? (
            <div
              className="rem-row"
              style={{ marginBottom: 'var(--space-sm)' }}
            >
              <span className="rem-label" style={{ minWidth: '60px' }}>
                确认
              </span>
              <PwInput
                value={confirmPw}
                onChange={setConfirmPw}
                placeholder="确认新密码"
              />
            </div>
          ) : mode === 'enter' ? (
            <div
              className="rem-row"
              style={{ marginBottom: 'var(--space-sm)' }}
            >
              <span className="rem-label" style={{ minWidth: '60px' }}>
                密码
              </span>
              <PwInput
                value={newPw}
                onChange={setNewPw}
                placeholder="请输入密码"
              />
            </div>
          ) : null}
        </div>
        <div className="rem-footer">
          <button type="button" className="shared-btn" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="shared-btn shared-btn-primary"
            onClick={handleSubmit}
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}
