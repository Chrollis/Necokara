/**
 * LangSelect — a custom dropdown for choosing a language.
 *
 * Native `<select>` dropdowns render as OS widgets (Win32 combobox) whose
 * scrollbar cannot be styled with CSS. This component replaces it with a
 * styled list so the scrollbar matches the app (see .lang-select-list in
 * editor.css).
 */
import { useRef, useState } from 'react';
import { useClickOutside } from '../hooks/useClickOutside';
import { whisperLangName } from '../whisper-languages';

interface LangSelectProps {
  languages: string[];
  value: string;
  onChange: (code: string) => void;
}

export default function LangSelect({
  languages,
  value,
  onChange,
}: LangSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useClickOutside(rootRef, open, () => setOpen(false));

  return (
    <div
      ref={rootRef}
      className="lang-select"
      style={{ position: 'relative', width: 140, flex: 'none' }}
    >
      <button
        type="button"
        className="lang-select-trigger"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="lang-select-value">{whisperLangName(value)}</span>
        <span className="mdi mdi-chevron-down lang-select-arrow" />
      </button>
      {open && (
        <div className="lang-select-list">
          {languages.map((code) => (
            <button
              type="button"
              key={code}
              className={`lang-select-item${
                code === value ? ' lang-select-item-selected' : ''
              }`}
              onClick={() => {
                onChange(code);
                setOpen(false);
              }}
            >
              {whisperLangName(code)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
