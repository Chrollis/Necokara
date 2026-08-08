import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  FfmpegValidation,
  PythonValidation,
  ResourceConfig,
} from '../../shared/ipc';
import ResourceConfigToolbar from './ResourceConfigToolbar';
import type { UpdateStatus } from '../../renderer/hooks/useUpdater';
import UpdateButton from '../../shared/components/UpdateButton';
import { APP_VERSION } from '../../project/project';
import './resource-config.css';

interface ResourceConfigViewProps {
  updateStatus: UpdateStatus;
  onInstallUpdate: () => void;
}

export default function ResourceConfigView({
  updateStatus,
  onInstallUpdate,
}: ResourceConfigViewProps) {
  const [config, setConfig] = useState<ResourceConfig>({
    ffmpegPath: '',
    pythonPath: '',
  });
  const [drafts, setDrafts] = useState({
    ffmpegPath: '',
    pythonPath: '',
  });
  const [ffmpegResult, setFfmpegResult] = useState<FfmpegValidation | null>(
    null,
  );
  const [pythonResult, setPythonResult] = useState<PythonValidation | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const configRef = useRef(config);
  const ffmpegPathRef = useRef('');
  const pythonPathRef = useRef('');

  const applyConfig = useCallback((cfg: ResourceConfig) => {
    configRef.current = cfg;
    setConfig(cfg);
    setDrafts({ ffmpegPath: cfg.ffmpegPath, pythonPath: cfg.pythonPath });
    ffmpegPathRef.current = cfg.ffmpegPath;
    pythonPathRef.current = cfg.pythonPath;
  }, []);

  const refresh = useCallback(async (cfg: ResourceConfig) => {
    const f = await window.electron.resources.validateFfmpeg(cfg.ffmpegPath);
    if (ffmpegPathRef.current === cfg.ffmpegPath) setFfmpegResult(f);
    const p = await window.electron.resources.validatePython(cfg.pythonPath);
    if (pythonPathRef.current === cfg.pythonPath) setPythonResult(p);
  }, []);

  // Load config on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cfg = await window.electron.resources.getConfig();
      if (cancelled) return;
      applyConfig(cfg);
      setLoading(false);
      await refresh(cfg);
    })();
    return () => {
      cancelled = true;
    };
  }, [applyConfig, refresh]);

  const save = useCallback(
    async (next: ResourceConfig) => {
      const saved = await window.electron.resources.setConfig(next);
      applyConfig(saved);
      await refresh(saved);
    },
    [applyConfig, refresh],
  );

  const pickFfmpeg = useCallback(async () => {
    const p =
      await window.electron.resources.pickFile('选择 ffmpeg 可执行文件');
    if (p) await save({ ...configRef.current, ffmpegPath: p });
  }, [save]);

  const pickPython = useCallback(async () => {
    const p =
      await window.electron.resources.pickFile('选择 Python 可执行文件');
    if (p) await save({ ...configRef.current, pythonPath: p });
  }, [save]);

  const clearFfmpeg = useCallback(() => {
    save({ ...configRef.current, ffmpegPath: '' });
  }, [save]);

  const clearPython = useCallback(() => {
    save({ ...configRef.current, pythonPath: '' });
  }, [save]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh(configRef.current);
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  // Badge / detail helpers
  const ffmpegBadge = (() => {
    if (!config.ffmpegPath) return { cls: 'rc-badge-mute', text: '未配置' };
    if (ffmpegResult?.ok) return { cls: 'rc-badge-ok', text: '可用' };
    return { cls: 'rc-badge-bad', text: '不可用' };
  })();

  const pythonBadge = (() => {
    if (!config.pythonPath) return { cls: 'rc-badge-mute', text: '未配置' };
    if (pythonResult?.ok) return { cls: 'rc-badge-ok', text: '可用' };
    return { cls: 'rc-badge-bad', text: '不可用' };
  })();

  return (
    <div className="rc-root">
      <ResourceConfigToolbar
        onRefresh={handleRefresh}
        refreshing={refreshing}
      />
      <div className="rc-body">
        {loading ? (
          <div className="rc-loading">加载中…</div>
        ) : (
          <div className="rc-cards">
            {/* ── ffmpeg ── */}
            <section className="rc-card">
              <header className="rc-card-header">
                <span className="rc-card-title">
                  <span className="mdi mdi-file-cog-outline" /> FFmpeg路径
                </span>
                <span className={`rc-badge ${ffmpegBadge.cls}`}>
                  {ffmpegBadge.text}
                </span>
              </header>
              <div className="rc-row">
                <input
                  className="rc-input"
                  type="text"
                  value={drafts.ffmpegPath}
                  placeholder="选择 ffmpeg 可执行文件"
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, ffmpegPath: e.target.value }))
                  }
                  onBlur={() => {
                    if (drafts.ffmpegPath !== configRef.current.ffmpegPath) {
                      save({
                        ...configRef.current,
                        ffmpegPath: drafts.ffmpegPath,
                      });
                    }
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter')
                      (e.target as HTMLInputElement).blur();
                  }}
                />
                <button
                  type="button"
                  className="shared-btn"
                  onClick={pickFfmpeg}
                >
                  选择文件
                </button>
                <button
                  type="button"
                  className="shared-btn"
                  disabled={!config.ffmpegPath}
                  onClick={clearFfmpeg}
                >
                  清除
                </button>
              </div>
              <div className="rc-detail">
                {!config.ffmpegPath ? (
                  <span className="rc-detail-mute">
                    用于视频合成渲染（导出）。请指定 ffmpeg 可执行文件。
                  </span>
                ) : ffmpegResult?.ok ? (
                  <span className="rc-detail-ok">
                    <span className="mdi mdi-check-circle-outline" />{' '}
                    {ffmpegResult.version}
                  </span>
                ) : (
                  <span className="rc-detail-bad">
                    <span className="mdi mdi-alert-circle-outline" />{' '}
                    {ffmpegResult?.error ?? '校验失败'}
                  </span>
                )}
              </div>
            </section>

            {/* ── Python ── */}
            <section className="rc-card">
              <header className="rc-card-header">
                <span className="rc-card-title">
                  <span className="mdi mdi-language-python" /> Python解释器
                </span>
                <span className={`rc-badge ${pythonBadge.cls}`}>
                  {pythonBadge.text}
                </span>
              </header>
              <div className="rc-row">
                <input
                  className="rc-input"
                  type="text"
                  value={drafts.pythonPath}
                  placeholder="选择 python.exe（推理环境）"
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, pythonPath: e.target.value }))
                  }
                  onBlur={() => {
                    if (drafts.pythonPath !== configRef.current.pythonPath) {
                      save({
                        ...configRef.current,
                        pythonPath: drafts.pythonPath,
                      });
                    }
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter')
                      (e.target as HTMLInputElement).blur();
                  }}
                />
                <button
                  type="button"
                  className="shared-btn"
                  onClick={pickPython}
                >
                  选择文件
                </button>
                <button
                  type="button"
                  className="shared-btn"
                  disabled={!config.pythonPath}
                  onClick={clearPython}
                >
                  清除
                </button>
              </div>
              <div className="rc-detail">
                {!config.pythonPath ? (
                  <span className="rc-detail-mute">
                    用于人声分离 / 对齐推理。请选择 python\.conda-env 下的
                    python.exe。
                  </span>
                ) : pythonResult?.ok ? (
                  <span className="rc-detail-ok">
                    <span className="mdi mdi-check-circle-outline" />{' '}
                    {pythonResult.version}（依赖齐全）
                  </span>
                ) : (
                  <span className="rc-detail-bad">
                    <span className="mdi mdi-alert-circle-outline" />{' '}
                    {pythonResult?.error ?? '校验失败'}
                  </span>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
      {/* bottom bar, same as the project view */}
      <div className="pv-bottom">
        <UpdateButton status={updateStatus} onInstall={onInstallUpdate} />
        <span style={{ marginLeft: 'auto' }}>ver: {APP_VERSION}</span>
      </div>
    </div>
  );
}
