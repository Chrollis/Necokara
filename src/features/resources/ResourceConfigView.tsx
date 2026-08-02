import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  FfmpegValidation,
  ModelDirInspection,
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
    modelDir: '',
    ffmpegPath: '',
  });
  const [drafts, setDrafts] = useState({
    modelDir: '',
    ffmpegPath: '',
  });
  const [modelInspect, setModelInspect] = useState<ModelDirInspection | null>(
    null,
  );
  const [ffmpegResult, setFfmpegResult] = useState<FfmpegValidation | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const configRef = useRef(config);
  const modelDirRef = useRef('');
  const ffmpegPathRef = useRef('');

  const applyConfig = useCallback((cfg: ResourceConfig) => {
    configRef.current = cfg;
    setConfig(cfg);
    setDrafts({ modelDir: cfg.modelDir, ffmpegPath: cfg.ffmpegPath });
    modelDirRef.current = cfg.modelDir;
    ffmpegPathRef.current = cfg.ffmpegPath;
  }, []);

  const refresh = useCallback(async (cfg: ResourceConfig) => {
    const m = await window.electron.resources.inspectModelDir(cfg.modelDir);
    if (modelDirRef.current === cfg.modelDir) setModelInspect(m);
    const f = await window.electron.resources.validateFfmpeg(cfg.ffmpegPath);
    if (ffmpegPathRef.current === cfg.ffmpegPath) setFfmpegResult(f);
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

  const pickModelDir = useCallback(async () => {
    const dir = await window.electron.resources.pickDirectory('选择模型目录');
    if (dir) await save({ ...configRef.current, modelDir: dir });
  }, [save]);

  const pickFfmpeg = useCallback(async () => {
    const p =
      await window.electron.resources.pickFile('选择 ffmpeg 可执行文件');
    if (p) await save({ ...configRef.current, ffmpegPath: p });
  }, [save]);

  const clearModelDir = useCallback(() => {
    save({ ...configRef.current, modelDir: '' });
  }, [save]);

  const clearFfmpeg = useCallback(() => {
    save({ ...configRef.current, ffmpegPath: '' });
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
  const modelBadge = (() => {
    if (!config.modelDir) return { cls: 'rc-badge-mute', text: '未配置' };
    if (!modelInspect?.exists) return { cls: 'rc-badge-bad', text: '目录无效' };
    const hasErr = modelInspect.issues.some((i) => i.severity === 'error');
    const hasWarn = modelInspect.issues.some((i) => i.severity === 'warn');
    if (hasErr) return { cls: 'rc-badge-bad', text: '配置异常' };
    if (hasWarn) return { cls: 'rc-badge-warn', text: '已配置（有警告）' };
    return { cls: 'rc-badge-ok', text: '已配置' };
  })();

  const ffmpegBadge = (() => {
    if (!config.ffmpegPath) return { cls: 'rc-badge-mute', text: '未配置' };
    if (ffmpegResult?.ok) return { cls: 'rc-badge-ok', text: '可用' };
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
            {/* ── 模型目录 ── */}
            <section className="rc-card">
              <header className="rc-card-header">
                <span className="rc-card-title">
                  <span className="mdi mdi-folder-outline" /> 模型目录
                </span>
                <span className={`rc-badge ${modelBadge.cls}`}>
                  {modelBadge.text}
                </span>
              </header>
              <div className="rc-row">
                <input
                  className="rc-input"
                  type="text"
                  value={drafts.modelDir}
                  placeholder="选择包含 .onnx 模型的目录"
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, modelDir: e.target.value }))
                  }
                  onBlur={() => {
                    if (drafts.modelDir !== configRef.current.modelDir) {
                      save({ ...configRef.current, modelDir: drafts.modelDir });
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
                  onClick={pickModelDir}
                >
                  选择目录
                </button>
                <button
                  type="button"
                  className="shared-btn"
                  disabled={!config.modelDir}
                  onClick={clearModelDir}
                >
                  清除
                </button>
              </div>
              <div className="rc-detail">
                {!config.modelDir ? (
                  <span className="rc-detail-mute">
                    用于存放人声分离 / 对齐模型（.onnx）。
                  </span>
                ) : !modelInspect?.exists ? (
                  <span className="rc-detail-bad">
                    <span className="mdi mdi-alert-circle-outline" />{' '}
                    目录不存在，请检查路径。
                  </span>
                ) : modelInspect.onnxFiles.length > 0 ? (
                  <div className="rc-file-list">
                    {modelInspect.onnxFiles.map((f) => (
                      <span key={f} className="rc-file-chip">
                        {f}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="rc-detail-warn">
                    <span className="mdi mdi-information-outline" />{' '}
                    目录有效，但未找到 .onnx 模型文件。
                  </span>
                )}
                {modelInspect && modelInspect.issues.length > 0 && (
                  <>
                    {modelInspect.issues.map((iss, i) => (
                      <div
                        key={i}
                        className={
                          iss.severity === 'error'
                            ? 'rc-detail-bad'
                            : 'rc-detail-warn'
                        }
                      >
                        <span className="mdi mdi-alert-circle-outline" />{' '}
                        {iss.message}
                      </div>
                    ))}
                  </>
                )}
              </div>
            </section>

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
