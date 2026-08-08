import { useRef, useState } from 'react';
import { useClickOutside } from '../../shared/hooks/useClickOutside';
import LangSelect from '../../shared/components/LangSelect';

export interface AutoTimingOptions {
  exportVocals: boolean;
  separateOnly: boolean;
  useSeparateCache: boolean;
  /** auto-timing language code (whisper code, e.g. 'ja') */
  languageCode: string;
  cleanVocal: boolean;
  cleanThreshold: number;
  snapToBeat: boolean;
}

interface AutoTimingDialogProps {
  /** whisper language codes (99, in official order) */
  languages: string[];
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
    languages.includes('ja') ? 'ja' : (languages[0] ?? ''),
  );

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
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 10px',
              border: '1px solid var(--hairline, rgba(128,128,128,0.3))',
              borderRadius: 'var(--radius-sm, 6px)',
              background: 'var(--canvas-soft, rgba(128,128,128,0.08))',
              fontSize: '12px',
              lineHeight: 1.5,
              color: 'var(--mute)',
            }}
          >
            <span className="mdi mdi-information-outline" />
            请确保歌词与注音准确，以获得最佳对齐质量
          </div>

          <div
            style={{
              borderTop: '1px solid var(--ink-soft, rgba(128,128,128,0.3))',
              margin: '10px 0',
            }}
          />

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
              歌词语言
            </span>
            <LangSelect
              languages={languages}
              value={language}
              onChange={setLanguage}
            />
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
            disabled={!language}
            onClick={() =>
              onConfirm({
                exportVocals,
                separateOnly,
                useSeparateCache,
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
