import { useState, useRef, useCallback } from 'react';
import { useClickOutside } from '../../shared/hooks/useClickOutside';
import type { Lyrics } from '../../editor/lyrics';
import { fromTxt, toTxt } from '../../editor/txtlyrics';
import { fromLrc, toLrc } from '../../editor/lrclyrics';
import { fromNicoLrc, toNicoLrc } from '../../editor/nicolyrics';
import { toJson, fromJson } from '../../editor/jsonlyrics';

interface ImportExportMenuProps {
  lyrics: Lyrics;
  onImport: (lyrics: Lyrics) => void;
}

type MenuTab = 'import' | 'export';

export default function ImportExportMenu({
  lyrics,
  onImport,
}: ImportExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<MenuTab>('import');
  const [text, setText] = useState('');
  const [format, setFormat] = useState<'txt' | 'lrc' | 'nico' | 'json'>('txt');
  const [exportText, setExportText] = useState('');
  const [fileName, setFileName] = useState('');
  const [menuRect, setMenuRect] = useState<DOMRect | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useClickOutside(menuRef, open, () => setOpen(false));

  const handleImport = useCallback(() => {
    try {
      let result: Lyrics;
      switch (format) {
        case 'txt':
          result = fromTxt(text);
          break;
        case 'lrc':
          result = fromLrc(text);
          break;
        case 'nico':
          result = fromNicoLrc(text);
          break;
        case 'json':
          result = fromJson(JSON.parse(text));
          break;
      }
      onImport(result);
      setOpen(false);
      setText('');
    } catch {
      // parse error — let user fix the text
    }
  }, [format, text, onImport]);

  function exportLyrics(lyr: Lyrics, fmt: typeof format): string {
    switch (fmt) {
      case 'txt':
        return toTxt(lyr);
      case 'lrc':
        return toLrc(lyr);
      case 'nico':
        return toNicoLrc(lyr);
      case 'json':
        return toJson(lyr);
    }
  }

  const handleFilePicked = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setFileName(file.name);
      const reader = new FileReader();
      reader.onload = () => {
        setText(reader.result as string);
      };
      reader.readAsText(file);
      e.target.value = '';
    },
    [],
  );

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(exportText);
  }, [exportText]);

  const handleDownload = useCallback(() => {
    const ext =
      format === 'json'
        ? 'json'
        : format === 'lrc'
          ? 'lrc'
          : format === 'nico'
            ? 'nico'
            : 'txt';
    const blob = new Blob([exportText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lyrics.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }, [exportText, format]);

  const formats: { key: typeof format; label: string }[] = [
    { key: 'txt', label: '纯文本' },
    { key: 'lrc', label: 'LRC' },
    { key: 'nico', label: 'NicoLRC' },
    { key: 'json', label: 'JSON' },
  ];

  const formatLabels: Record<string, string> = {
    txt: '纯文本',
    lrc: 'LRC',
    nico: 'NicoLRC',
    json: 'JSON',
  };

  return (
    <div className="iem-root">
      <div className="iem-buttons">
        <button
          ref={btnRef}
          type="button"
          className="shared-btn"
          onClick={() => {
            const r = btnRef.current?.getBoundingClientRect();
            if (r) setMenuRect(r);
            setTab('import');
            setOpen(!open);
            setText('');
            setFileName('');
          }}
        >
          <span className="mdi mdi-import" /> 导入
        </button>
        <button
          type="button"
          className="shared-btn"
          onClick={() => {
            const r = btnRef.current?.getBoundingClientRect();
            if (r) setMenuRect(r);
            setTab('export');
            setOpen(!open);
            setExportText(exportLyrics(lyrics, format));
          }}
        >
          <span className="mdi mdi-export" /> 导出
        </button>
      </div>

      {open && menuRect && (
        <div ref={menuRef} className="iem-dropdown" style={{ position: 'fixed', left: menuRect.left, top: menuRect.bottom + 4 }}>
          <div className="iem-tabs">
            {formats.map((f) => (
              <button
                key={f.key}
                type="button"
                className={['iem-tab', format === f.key ? 'iem-tab-active' : '']
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => {
                  setFormat(f.key);
                  if (tab === 'export') {
                    const out = exportLyrics(lyrics, f.key);
                    setExportText(out);
                  }
                }}
              >
                {f.label}
              </button>
            ))}
          </div>

          {tab === 'import' && (
            <div className="iem-panel">
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.lrc,.nico,.json,text/plain"
                style={{ display: 'none' }}
                onChange={handleFilePicked}
              />
              <textarea
                ref={inputRef}
                className="iem-textarea"
                rows={8}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={`粘贴${formatLabels[format]}内容或上传文件...`}
              />
              <div className="iem-panel-footer">
                  <button
                    type="button"
                    className="shared-btn"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <span className="mdi mdi-file-upload" /> 上传
                  </button>
                  {fileName && (
                    <span className="iem-file-name">{fileName}</span>
                  )}
                <button
                  type="button"
                  className="shared-btn shared-btn-primary"
                  onClick={handleImport}
                >
                  <span className="mdi mdi-check" /> 应用
                </button>
              </div>
            </div>
          )}

          {tab === 'export' && (
            <div className="iem-panel">
              <textarea
                className="iem-textarea"
                rows={8}
                value={exportText}
                readOnly
              />
              <div className="iem-panel-footer">
                <button type="button" className="shared-btn" onClick={handleCopy}>
                  <span className="mdi mdi-content-copy" /> 复制
                </button>
                <button
                  type="button"
                  className="shared-btn shared-btn-primary"
                  onClick={handleDownload}
                >
                  <span className="mdi mdi-download" /> 下载
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
