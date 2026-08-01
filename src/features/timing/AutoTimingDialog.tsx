import { useRef, useState } from 'react';
import { useClickOutside } from '../../shared/hooks/useClickOutside';

export interface AutoTimingOptions {
  exportVocals: boolean;
  separateOnly: boolean;
  useSeparateCache: boolean;
  languageToken: number;
  cleanVocal: boolean;
  cleanThreshold: number;
  snapToBeat: boolean;
}

/** Whisper language code → Chinese display name. */
const LANG_NAMES: Record<string, string> = {
  en: '英语',
  zh: '中文',
  de: '德语',
  es: '西班牙语',
  ru: '俄语',
  ko: '韩语',
  fr: '法语',
  ja: '日语',
  pt: '葡萄牙语',
  tr: '土耳其语',
  pl: '波兰语',
  ca: '加泰罗尼亚语',
  nl: '荷兰语',
  ar: '阿拉伯语',
  sv: '瑞典语',
  it: '意大利语',
  id: '印尼语',
  hi: '印地语',
  fi: '芬兰语',
  vi: '越南语',
  he: '希伯来语',
  uk: '乌克兰语',
  el: '希腊语',
  ms: '马来语',
  cs: '捷克语',
  ro: '罗马尼亚语',
  da: '丹麦语',
  hu: '匈牙利语',
  ta: '泰米尔语',
  no: '挪威语',
  th: '泰语',
  ur: '乌尔都语',
  hr: '克罗地亚语',
  bg: '保加利亚语',
  lt: '立陶宛语',
  la: '拉丁语',
  mi: '毛利语',
  ml: '马拉雅拉姆语',
  cy: '威尔士语',
  sk: '斯洛伐克语',
  te: '泰卢固语',
  fa: '波斯语',
  lv: '拉脱维亚语',
  bn: '孟加拉语',
  sr: '塞尔维亚语',
  az: '阿塞拜疆语',
  sl: '斯洛文尼亚语',
  kn: '卡纳达语',
  et: '爱沙尼亚语',
  mk: '马其顿语',
  br: '布列塔尼语',
  eu: '巴斯克语',
  is: '冰岛语',
  hy: '亚美尼亚语',
  ne: '尼泊尔语',
  mn: '蒙古语',
  bs: '波斯尼亚语',
  kk: '哈萨克语',
  sq: '阿尔巴尼亚语',
  sw: '斯瓦希里语',
  gl: '加利西亚语',
  mr: '马拉地语',
  pa: '旁遮普语',
  si: '僧伽罗语',
  km: '高棉语',
  sn: '绍纳语',
  yo: '约鲁巴语',
  so: '索马里语',
  af: '南非荷兰语',
  oc: '奥克语',
  ka: '格鲁吉亚语',
  be: '白俄罗斯语',
  tg: '塔吉克语',
  sd: '信德语',
  gu: '古吉拉特语',
  am: '阿姆哈拉语',
  yi: '意第绪语',
  lo: '老挝语',
  uz: '乌兹别克语',
  fo: '法罗语',
  ht: '海地克里奥尔语',
  ps: '普什图语',
  tk: '土库曼语',
  nn: '新挪威语',
  mt: '马耳他语',
  sa: '梵语',
  lb: '卢森堡语',
  my: '缅甸语',
  bo: '藏语',
  tl: '他加禄语',
  mg: '马达加斯加语',
  as: '阿萨姆语',
  tt: '鞑靼语',
  haw: '夏威夷语',
  ln: '林加拉语',
  ha: '豪萨语',
  ba: '巴什基尔语',
  jw: '爪哇语',
  su: '巽他语',
  yue: '粤语',
};

function langLabel(code: string): string {
  const name = LANG_NAMES[code];
  return name ? `${name} (${code})` : code;
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
          <div className="rem-row">
            <span className="rem-label">语言</span>
            <select
              className="rem-input"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              style={{ width: 180 }}
            >
              {languages.map((l) => (
                <option key={l.code} value={l.code}>
                  {langLabel(l.code)}
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
