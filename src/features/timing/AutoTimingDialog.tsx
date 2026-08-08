import { useRef, useState } from 'react';
import { useClickOutside } from '../../shared/hooks/useClickOutside';
import { whisperLangName } from '../../shared/whisper-languages';

export interface AutoTimingOptions {
  exportVocals: boolean;
  separateOnly: boolean;
  useSeparateCache: boolean;
  languageToken: number;
  /** auto-timing language code (ja/zh/en), drives the alignment branch */
  languageCode: string;
  cleanVocal: boolean;
  cleanThreshold: number;
  snapToBeat: boolean;
}

interface AutoTimingDialogProps {
  languages: Array<{ code: string; id: number }>;
  onConfirm: (options: AutoTimingOptions) => void;
  onCancel: () => void;
}

export default function AutoTimingDialog({
  languages,
  onConfirm,
  onCancel,
}: AutoTimingDialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  useClickOutside(overlayRef, true, onCancel);

  const [exportVocals, setExportVocals] = useState(false);
  const [separateOnly, setSeparateOnly] = useState(false);
  const [useSeparateCache, setUseSeparateCache] = useState(false);
  const [cleanVocal, setCleanVocal] = useState(true);
  const [snapToBeat, setSnapToBeat] = useState(false);
  const [cleanThreshold, setCleanThreshold] = useState(20);
  const [language, setLanguage] = useState<string>(
    languages.find((l) => l.code === 'ja')?.code ?? languages[0]?.code ?? '',
  );

  const lang = languages.find((l) => l.code === language);

  return (
    <div className="rem-overlay" ref={overlayRef}>
      <div
        className="rem-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ minWidth: '360px' }}
      >
        <div className="rem-header">
          <span className="rem-title">自动打轴</span>
          <button
            type="button"
            className="rem-close"
            onClick={onCancel}
            title="关闭"
          >
            <span className="mdi mdi-close" />
          </button>
        </div>

        <div className="rem-body">
          <div
            className="rem-row"
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flex: 1,
              }}
            >
              <span className="mdi mdi-translate align-lang-icon" />
              语言
            </span>
            <select
              className="rem-input"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              style={{ width: 140, flex: 'none' }}
            >
              {languages.map((l) => (
                <option key={l.code} value={l.code}>
                  {whisperLangName(l.code)}
                </option>
              ))}
            </select>
          </div>

          <div
            style={{
              borderTop: '1px solid var(--ink-soft, rgba(128,128,128,0.3))',
              margin: '10px 0',
            }}
          />

          <label
            className="rem-row"
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <input
              type="checkbox"
              checked={exportVocals}
              onChange={(e) => {
                setExportVocals(e.target.checked);
                if (!e.target.checked) setSeparateOnly(false);
              }}
            />
            <span>输出人声/伴奏到源音频目录</span>
          </label>

          <label
            className="rem-row"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              opacity: exportVocals && !useSeparateCache ? 1 : 0.5,
            }}
          >
            <input
              type="checkbox"
              checked={separateOnly}
              disabled={!exportVocals || useSeparateCache}
              onChange={(e) => setSeparateOnly(e.target.checked)}
            />
            <span>仅分离人声</span>
          </label>

          <div
            style={{
              borderTop: '1px solid var(--ink-soft, rgba(128,128,128,0.3))',
              margin: '10px 0',
            }}
          />

          <label
            className="rem-row"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              opacity: separateOnly ? 0.5 : 1,
            }}
          >
            <input
              type="checkbox"
              checked={useSeparateCache}
              disabled={separateOnly}
              onChange={(e) => setUseSeparateCache(e.target.checked)}
            />
            <span>使用分离缓存</span>
          </label>

          <div
            className="rem-row"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              opacity: separateOnly ? 0.5 : 1,
            }}
          >
            <label
              style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}
            >
              <input
                type="checkbox"
                checked={cleanVocal}
                disabled={separateOnly}
                onChange={(e) => setCleanVocal(e.target.checked)}
              />
              <span>降噪强度</span>
            </label>
            <input
              type="number"
              min={5}
              max={40}
              step={1}
              value={cleanThreshold}
              disabled={!cleanVocal || separateOnly}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!Number.isNaN(v)) setCleanThreshold(v);
              }}
              style={{
                height: '32px',
                width: 64,
                textAlign: 'center',
                fontFamily: 'var(--font-mono)',
                fontSize: '13px',
                border: '1px solid var(--hairline)',
                borderRadius: 'var(--radius-sm)',
                padding: '0 4px',
                background: 'var(--canvas)',
                color: 'var(--ink)',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            <span style={{ fontSize: '12px', color: 'var(--mute)' }}>%</span>
          </div>

          <label
            className="rem-row"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              opacity: separateOnly ? 0.5 : 1,
            }}
          >
            <input
              type="checkbox"
              checked={snapToBeat}
              disabled={separateOnly}
              onChange={(e) => setSnapToBeat(e.target.checked)}
            />
            <span>对齐到32分音符</span>
          </label>
        </div>

        <div className="rem-footer">
          <button type="button" className="shared-btn" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="shared-btn shared-btn-primary"
            disabled={!lang}
            onClick={() =>
              onConfirm({
                exportVocals,
                separateOnly,
                useSeparateCache,
                languageToken: lang?.id ?? -1,
                languageCode: language,
                cleanVocal,
                cleanThreshold,
                snapToBeat,
              })
            }
          >
            确认
          </button>
        </div>
      </div>
    </div>
  );
}
