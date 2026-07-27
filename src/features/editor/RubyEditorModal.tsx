import { useState } from 'react';
import type { Word } from '../../editor/word';

interface RubyEditorModalProps {
  word: Word;
  wordIndex: number;
  onSave: (wordIndex: number, syllables: Array<{ reading: string }>) => void;
  onResetDefault: (wordIndex: number) => void;
  onClose: () => void;
}

export default function RubyEditorModal({
  word,
  wordIndex,
  onSave,
  onResetDefault,
  onClose,
}: RubyEditorModalProps) {
  const [readings, setReadings] = useState(
    word.syllables.map((s) => s.reading),
  );

  const updateReading = (idx: number, value: string) => {
    setReadings((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  };

  const addSyllable = () => {
    setReadings((prev) => [...prev, '']);
  };

  const removeSyllable = (idx: number) => {
    if (readings.length <= 1) return;
    setReadings((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = () => {
    const cleaned = readings.filter((r) => r.trim().length > 0);
    if (cleaned.length === 0) return;
    onSave(
      wordIndex,
      cleaned.map((r) => ({ reading: r })),
    );
    onClose();
  };

  return (
    <div className="rem-overlay" onClick={onClose}>
      <div className="rem-modal" onClick={(e) => e.stopPropagation()}>
        <div className="rem-header">
          <span className="rem-title">编辑注音: {word.reading}</span>
          <button type="button" className="rem-close" onClick={onClose}>
            <span className="mdi mdi-close" />
          </button>
        </div>

        <div className="rem-body">
          {readings.map((r, i) => (
            <div className="rem-row" key={i}>
              <span className="rem-label">{i + 1}.</span>
              <input
                className="rem-input"
                value={r}
                onChange={(e) => updateReading(i, e.target.value)}
                autoFocus={i === readings.length - 1}
              />
              <button
                type="button"
                className="rem-btn-remove"
                disabled={readings.length <= 1}
                onClick={() => removeSyllable(i)}
              >
                <span className="mdi mdi-minus" />
              </button>
            </div>
          ))}

          <button type="button" className="rem-btn-add" onClick={addSyllable}>
            <span className="mdi mdi-plus" /> 添加音节
          </button>
        </div>

        <div className="rem-footer">
          <button
            type="button"
            className="shared-btn"
            onClick={() => {
              onResetDefault(wordIndex);
              onClose();
            }}
          >
            恢复默认
          </button>
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
