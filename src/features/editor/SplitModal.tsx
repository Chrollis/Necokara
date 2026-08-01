import { useState } from 'react';
import type { Word } from '../../editor/word';

interface SplitModalProps {
  word: Word;
  wordIndex: number;
  onSave: (wordIndex: number, leftText: string, rightText: string) => void;
  onClose: () => void;
  snack?: { show: (msg: string) => void };
}

export default function SplitModal({
  word,
  wordIndex,
  onSave,
  onClose,
  snack,
}: SplitModalProps) {
  const [left, setLeft] = useState(
    word.reading.slice(0, Math.ceil(word.reading.length / 2)),
  );
  const [right, setRight] = useState(
    word.reading.slice(Math.ceil(word.reading.length / 2)),
  );

  const handleSave = () => {
    const l = left.replace(/\s/g, '');
    const r = right.replace(/\s/g, '');
    if (l.length === 0 || r.length === 0) {
      snack?.show('拆分结果不能为空');
      return;
    }
    if (l + r !== word.reading) {
      snack?.show('左右拼接后必须与原词一致');
      return;
    }
    onSave(wordIndex, l, r);
    onClose();
  };

  return (
    <div
      className="rem-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="rem-modal">
        <div className="rem-header">
          <span className="rem-title">拆分: {word.reading}</span>
          <button
            type="button"
            className="rem-close"
            onClick={onClose}
            title="关闭"
          >
            <span className="mdi mdi-close" />
          </button>
        </div>

        <div className="rem-body">
          <div className="rem-row">
            <span className="rem-label">左</span>
            <input
              className="rem-input"
              value={left}
              onChange={(e) => setLeft(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>
          <div className="rem-row">
            <span className="rem-label">右</span>
            <input
              className="rem-input"
              value={right}
              onChange={(e) => setRight(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
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
            拆分
          </button>
        </div>
      </div>
    </div>
  );
}
