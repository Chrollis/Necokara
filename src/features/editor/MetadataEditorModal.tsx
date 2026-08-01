import { useState, useRef } from 'react';
import { useClickOutside } from '../../shared/hooks/useClickOutside';

interface MetadataEditorModalProps {
  metadata: Record<string, string>;
  onSave: (meta: Record<string, string>) => void;
  onClose: () => void;
  snack?: { show: (msg: string, durationMs?: number) => void };
}

const DEFAULT_KEYS: { key: string; label: string }[] = [
  { key: 'title', label: '标题' },
  { key: 'artist', label: '歌手' },
  { key: 'album', label: '专辑' },
  { key: 'timer', label: '计时' },
  { key: 'lyricist', label: '作词' },
  { key: 'offset', label: '偏移' },
];

export default function MetadataEditorModal({
  metadata: initialMetadata,
  onSave,
  onClose,
  snack,
}: MetadataEditorModalProps) {
  const buildEntries = (meta: Record<string, string>) => {
    const result: { key: string; value: string; isDefault: boolean }[] = [];
    const handled = new Set<string>();
    for (const d of DEFAULT_KEYS) {
      result.push({ key: d.key, value: meta[d.key] ?? '', isDefault: true });
      handled.add(d.key);
    }
    for (const [k, v] of Object.entries(meta)) {
      if (!handled.has(k)) {
        result.push({ key: k, value: v, isDefault: false });
      }
    }
    return result;
  };

  const [entries, setEntries] = useState(() => buildEntries(initialMetadata));
  const [newKey, setNewKey] = useState('');
  const modalRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  useClickOutside(overlayRef, true, onClose);

  const updateEntry = (i: number, field: 'key' | 'value', val: string) => {
    setEntries((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], [field]: val };
      return next;
    });
  };

  const removeEntry = (i: number) => {
    setEntries((prev) => prev.filter((_, idx) => idx !== i));
  };

  const addEntry = () => {
    const trimmed = newKey.trim();
    if (!trimmed) return;
    if (entries.some((e) => e.key === trimmed)) {
      snack?.show(`字段 "${trimmed}" 已存在`);
      return;
    }
    setEntries((prev) => [
      ...prev,
      { key: trimmed, value: '', isDefault: false },
    ]);
    setNewKey('');
  };

  const handleSave = () => {
    const meta: Record<string, string> = {};
    entries.forEach((e) => {
      if (e.key.trim()) meta[e.key.trim()] = e.value;
    });
    onSave(meta);
    onClose();
  };

  return (
    <div className="rem-overlay" ref={overlayRef}>
      <div
        className="rem-modal"
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        style={{ minWidth: '420px', maxWidth: '500px' }}
      >
        <div className="rem-header">
          <span className="rem-title">元数据编辑</span>
          <button
            type="button"
            className="rem-close"
            onClick={onClose}
            title="关闭"
          >
            <span className="mdi mdi-close" />
          </button>
        </div>
        <div className="rem-body" style={{ maxHeight: '50vh' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '80px 1fr auto',
              gap: '6px',
              alignItems: 'center',
            }}
          >
            {/* Scrollable key column (all rows) */}
            <div style={{ overflow: 'hidden' }}>
              {entries.map((entry, i) => {
                const defaultInfo = DEFAULT_KEYS.find(
                  (d) => d.key === entry.key,
                );
                return (
                  <div
                    key={i}
                    style={{
                      lineHeight: '34px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={defaultInfo?.label ?? entry.key}
                  >
                    {defaultInfo?.label ?? entry.key}
                  </div>
                );
              })}
            </div>
            {/* Value inputs */}
            <div>
              {entries.map((entry, i) => (
                <div key={i} style={{ marginBottom: '6px', height: '28px' }}>
                  <input
                    className="rem-input"
                    style={{
                      width: '100%',
                      height: '28px',
                      background: entry.isDefault ? '#ffffff' : undefined,
                    }}
                    value={entry.value}
                    onChange={(e) => updateEntry(i, 'value', e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                    placeholder=""
                  />
                </div>
              ))}
            </div>
            {/* Remove buttons */}
            <div>
              {entries.map((entry, i) => (
                <div
                  key={i}
                  style={{
                    marginBottom: '6px',
                    height: '28px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <button
                    type="button"
                    className="rem-btn-remove"
                    disabled={entry.isDefault}
                    onClick={() => removeEntry(i)}
                    style={{
                      width: '28px',
                      height: '28px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <span className="mdi mdi-minus" />
                  </button>
                </div>
              ))}
            </div>
          </div>
          {/* Add new key row (separate, not scrollable) */}
          <div className="rem-row" style={{ gap: '6px', marginTop: '8px' }}>
            <input
              className="rem-input"
              style={{
                width: '80px',
                flex: 'none',
                border: 'none',
                borderBottom: '1px solid var(--hairline)',
                borderRadius: 0,
                background: 'transparent',
                padding: '0 2px',
              }}
              value={newKey}
              onChange={(e) => setNewKey(e.target.value.toLowerCase())}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') addEntry();
              }}
              placeholder="字段名"
            />
            <button
              type="button"
              className="shared-btn"
              onClick={addEntry}
              style={{ flex: 1, justifyContent: 'center' }}
            >
              <span className="mdi mdi-plus" /> 添加
            </button>
          </div>
        </div>
        <div className="rem-footer">
          <button type="button" className="shared-btn" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="shared-btn shared-btn-primary"
            onClick={handleSave}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
