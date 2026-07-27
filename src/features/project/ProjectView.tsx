import type { Project } from '../../project/project';
import { APP_VERSION } from '../../project/project';
import { isSeparatorWord } from '../../editor/word';

interface ProjectViewProps {
  project: Project | null;
  hasUserPassword: boolean;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onClose: () => void;
  onSetPassword: () => void;
  onClearPassword: () => void;
  recentFiles?: { filePath: string; fileName: string; dir: string }[];
  onOpenRecent?: (filePath: string) => void;
}

export default function ProjectView({
  project,
  hasUserPassword,
  onNew,
  onOpen,
  onSave,
  onSaveAs,
  onClose,
  onSetPassword,
  onClearPassword,
  recentFiles,
  onOpenRecent,
}: ProjectViewProps) {
  const hasProject = !!project;

  return (
    <div className="project-view">
      <div className="shared-toolbar">
        <div className="shared-toolbar-scroll">
          <button type="button" className="shared-btn" onClick={onNew}>
            <span className="mdi mdi-file-plus" /> 新建
          </button>
          <button type="button" className="shared-btn" onClick={onOpen}>
            <span className="mdi mdi-folder-open" /> 打开
          </button>
          <div className="shared-toolbar-sep" />
          <button
            type="button"
            className="shared-btn"
            onClick={onSave}
            disabled={!hasProject}
          >
            <span className="mdi mdi-content-save" /> 保存
          </button>
          <button
            type="button"
            className="shared-btn"
            onClick={onSaveAs}
            disabled={!hasProject}
          >
            <span className="mdi mdi-content-save-outline" /> 另存为
          </button>
          <div className="shared-toolbar-sep" />
          <button
            type="button"
            className="shared-btn"
            onClick={onClose}
            disabled={!hasProject}
          >
            <span className="mdi mdi-close-box" /> 关闭
          </button>
          <div className="shared-toolbar-sep" />
          <button
            type="button"
            className="shared-btn"
            onClick={onSetPassword}
            disabled={!hasProject}
          >
            <span className="mdi mdi-lock" />{' '}
            {hasUserPassword ? '更改密码' : '设置密码'}
          </button>
          <button
            type="button"
            className="shared-btn"
            onClick={onClearPassword}
            disabled={!hasProject}
          >
            <span className="mdi mdi-lock-off" /> 清除密码
          </button>
        </div>
      </div>
      <div className="pv-body">
        {hasProject ? (
          <>
            <div className="pv-card">
              <div className="pv-card-header">项目信息</div>
              <div className="pv-card-body">
                <div className="pv-info-row">
                  <span className="pv-label">文件</span>
                  <span>
                    {project?.filePath
                      ? project.filePath.split(/[/\\]/).pop()
                      : '未命名'}
                  </span>
                </div>
                <div className="pv-info-row">
                  <span className="pv-label">路径</span>
                  <span className="pv-mono">
                    {project?.filePath ?? '未保存'}
                  </span>
                </div>
                <div className="pv-info-row">
                  <span className="pv-label">修改时间</span>
                  <span>{project?.projectJson.updatedAt ?? '-'}</span>
                </div>
                <div className="pv-info-row">
                  <span className="pv-label">软件版本</span>
                  <span>v{project?.projectJson.version ?? APP_VERSION}</span>
                </div>
                <div className="pv-info-row">
                  <span className="pv-label">加密</span>
                  <span>{hasUserPassword ? '是' : '否'}</span>
                </div>
              </div>
            </div>
            <LyricsStatsCard project={project} />
            <TimingStatsCard project={project} />
          </>
        ) : (
          <div className="pv-body-empty">
            <div className="pv-empty-inner">
              <div className="pv-empty-col">
                <span className="pv-recent-title">最近打开过的项目</span>
                {recentFiles && recentFiles.length > 0 ? (
                  recentFiles.map((rf) => (
                    <div
                      key={rf.filePath}
                      className="pv-recent-item"
                      onClick={() => onOpenRecent?.(rf.filePath)}
                    >
                      <span className="pv-recent-name">{rf.fileName}</span>
                      <span className="pv-recent-dir">{rf.dir}</span>
                    </div>
                  ))
                ) : (
                  <span
                    style={{
                      color: 'var(--mute)',
                      fontSize: 'var(--font-size-sm)',
                    }}
                  >
                    暂无最近文件
                  </span>
                )}
              </div>
              <div className="pv-empty-divider" />
              <div className="pv-empty-col">
                <span className="pv-empty-hint">
                  打开或新建一个项目开始使用
                </span>
                <span className="pv-empty-action" onClick={onNew}>
                  <span className="mdi mdi-file-plus" /> 新建
                </span>
                <span className="pv-empty-action" onClick={onOpen}>
                  <span className="mdi mdi-folder-open" /> 打开
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="pv-bottom">ver: {APP_VERSION}</div>
    </div>
  );
}

function LyricsStatsCard({ project }: { project: Project | null }) {
  if (!project) return null;
  const words = project.lyrics.words;
  const contentWords = words.filter((w) => !isSeparatorWord(w));
  const totalSyllables = contentWords.reduce(
    (s, w) => s + w.syllables.length,
    0,
  );

  return (
    <div className="pv-card">
      <div className="pv-card-header">歌词数据</div>
      <div className="pv-card-body">
        <div className="pv-info-row">
          <span className="pv-label">单词数</span>
          <span>{words.length}</span>
        </div>
        <div className="pv-info-row">
          <span className="pv-label">音节数</span>
          <span>{totalSyllables}</span>
        </div>
        <div className="pv-info-row">
          <span className="pv-label">非分隔符音节数</span>
          <span>{totalSyllables}</span>
        </div>
      </div>
    </div>
  );
}

function TimingStatsCard({ project }: { project: Project | null }) {
  if (!project) return null;
  const timing = project.timing;
  const words = project.lyrics.words;
  const allSyllables = words.flatMap((w) => w.syllables);
  const setCount = allSyllables.filter((s) => s.isSet).length;
  const unsetCount = allSyllables.filter((s) => !s.isSet).length;

  return (
    <div className="pv-card">
      <div className="pv-card-header">打轴数据</div>
      <div className="pv-card-body">
        <div className="pv-info-row">
          <span className="pv-label">导入歌词地址</span>
          <span className="pv-mono" style={{ fontSize: '12px' }}>
            {timing.audioFilePath || '-'}
          </span>
        </div>
        <div className="pv-info-row">
          <span className="pv-label">打轴音节数</span>
          <span>{setCount}</span>
        </div>
        <div className="pv-info-row">
          <span className="pv-label">未打轴音节数</span>
          <span>{unsetCount}</span>
        </div>
        <div className="pv-info-row">
          <span className="pv-label">BPM 分段数</span>
          <span>{timing.fineTune.bpmSegments.length}</span>
        </div>
      </div>
    </div>
  );
}
