import { useState } from 'react';
import type { Word } from '../../editor/word';

interface BatchEditModalProps {
  words: Array<{ index: number; word: Word }>;
  onSave: (edits: Array<{ index: number; text: string }>) => void;
  onClose: () => void;
}

export default function BatchEditModal({
  words,
  onSave,
  onClose,
}: BatchEditModalProps) {
  const [edits, setEdits] = useState(
    words.map((w) => ({ index: w.index, text: w.word.reading })),
  );

  const updateText = (idx: number, value: string) => {
    setEdits((prev) => prev.map((e) => (e.index === idx ? { ...e, text: value } : e)));
  };

  const handleSave = () => {
    onSave(edits);
    onClose();
  };

  return (
    <div className="rem-overlay" onClick={onClose}>
      <div className="rem-modal" onClick={(e) => e.stopPropagation()}>
        <div className="rem-header">
          <span className="rem-title">编辑选区 ({words.length} 个词)</span>
          <button type="button" className="rem-close" onClick={onClose}>
            <span className="mdi mdi-close" />
          </button>
        </div>

        <div className="rem-body">
          {edits.map((e) => (
            <div className="rem-row" key={e.index}>
              <span className="rem-label">{e.index}.</span>
              <input
                className="rem-input"
                value={e.text}
                onChange={(ev) => updateText(e.index, ev.target.value)}
              />
            </div>
          ))}
        </div>

        <div className="rem-footer">
          <button type="button" className="ed-btn" onClick={onClose}>取消</button>
          <button type="button" className="ed-btn ed-btn-primary" onClick={handleSave}>
            <span className="mdi mdi-check" /> 保存
          </button>
        </div>
      </div>
    </div>
  );
}
