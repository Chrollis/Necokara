import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import '@mdi/font/css/materialdesignicons.css';
import './shared-components.css';
import './App.css';
import LyricsEditor from '../features/editor/LyricsEditor';
import TimingView from '../features/timing/TimingView';
import ProjectView from '../features/project/ProjectView';
import TopBar from './TopBar';
import PasswordDialog from './PasswordDialog';
import ConfirmDialog from './ConfirmDialog';
import { Project, APP_VERSION, type OpenResult } from '../project/project';
import { UndoManager } from '../project/undo-manager';
import { useSnackBar } from './SnackBar';
import { Lyrics } from '../editor/lyrics';
import {
  createUnsetWord,
  createSpaceWord,
  createNewlineWord,
} from '../editor/word';
import { createTimingState } from '../timing/state';
import { fromJson } from '../editor/jsonlyrics';
import { deserializeTimingState } from '../timing/serialization';
import AudioEngine from '../features/timing/AudioEngine';

export default function App() {
  const [currentView, setCurrentView] = useState<
    'project' | 'editor' | 'timing'
  >('project');
  const [renderVersion, setRenderVersion] = useState(0);
  const [isProjectOpen, setIsProjectOpen] = useState(false);
  const projectRef = useRef<Project | null>(null);
  const [undoManager] = useState(() => new UndoManager());
  const [snack, snackNode] = useSnackBar();
  const lyrics = projectRef.current?.lyrics ?? new Lyrics();
  const timing = projectRef.current?.timing ?? createTimingState();
  const [audioEngine, setAudioEngine] = useState<AudioEngine | null>(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioFileName, setAudioFileName] = useState('');
  const [recentFiles, setRecentFiles] = useState<
    { filePath: string; fileName: string; dir: string }[]
  >(() => {
    try {
      return JSON.parse(localStorage.getItem('necokara_recent') || '[]');
    } catch {
      return [];
    }
  });

  const addRecentFile = useCallback((filePath: string) => {
    setRecentFiles((prev) => {
      const filtered = prev.filter((f) => f.filePath !== filePath);
      const parts = filePath.split(/[/\\]/);
      const entry = {
        filePath,
        fileName: parts.pop() || '',
        dir: parts.join('/') || parts.join('\\'),
      };
      const next = [entry, ...filtered].slice(0, 10);
      localStorage.setItem('necokara_recent', JSON.stringify(next));
      return next;
    });
  }, []);

  const handleLyricsChange = useCallback(() => {
    setRenderVersion((v) => v + 1);
  }, []);

  const handleAudioChange = useCallback(
    (engine: AudioEngine | null, durationSec: number, fileName: string) => {
      setAudioEngine(engine);
      setAudioDuration(durationSec * 1000);
      setAudioFileName(fileName);
    },
    [],
  );

  // Destroy old AudioEngine when a new one is set (prevents AudioContext / ObjectURL leak)
  useEffect(() => {
    return () => {
      if (audioEngine) {
        audioEngine.destroy();
      }
    };
  }, [audioEngine]);

  // ── Dialog state ──
  const [pwDialog, setPwDialog] = useState<{
    mode: 'set' | 'change' | 'enter' | 'askSet' | 'askChange' | 'clear';
  } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    extraLabel?: string;
    onConfirm: () => void;
    onCancel?: () => void;
    onExtra?: () => void;
  } | null>(null);
  const pendingPwActionRef = useRef<'save' | 'saveAs'>('save');

  const handlePwConfirm = useCallback(
    async (password?: string, dontAskAgain?: boolean) => {
      const p = projectRef.current!;
      const doSaveWithPw = async (pw?: string) => {
        const fn =
          pendingPwActionRef.current === 'saveAs'
            ? p.saveAs.bind(p)
            : p.save.bind(p);
        return fn(pw);
      };
      if (pwDialog?.mode === 'askSet' || pwDialog?.mode === 'askChange') {
        const isChange = pwDialog.mode === 'askChange';
        if (dontAskAgain) {
          if (isChange) p.projectJson.skipChangePasswordPrompt = true;
          else p.projectJson.skipSetPasswordPrompt = true;
        }
        const fp = await doSaveWithPw(password || undefined);
        if (fp) snack?.show(`已保存: ${fp.split(/[/\\]/).pop()}`);
      } else if (pwDialog?.mode === 'enter') {
        const filePath = pendingOpenPathRef.current;
        if (!filePath) {
          snack?.show('请先选择文件');
          return;
        }
        const result = await window.electron.project.openPath(
          filePath,
          password,
        );
        if (!result) return;
        if ('error' in result) {
          snack?.show('密码错误');
          return;
        }
        const lyrics = fromJson(result.lyrics);
        const timing = deserializeTimingState(result.timing);
        const p = new Project(lyrics, timing);
        if (password) p.projectJson.userPassword = password;
        p.filePath = result.filePath;
        p.projectJson = result.projectJson || {
          version: APP_VERSION,
          createdAt: '',
          updatedAt: '',
        };
        p.hasUnsavedChanges = false;
        projectRef.current = p;
        setIsProjectOpen(true);
        setAudioEngine(null);
        setAudioDuration(0);
        setAudioFileName('');

        setRenderVersion((v) => v + 1);
        snack?.show(`已打开: ${result.filePath.split(/[/\\]/).pop()}`);
      } else if (pwDialog?.mode === 'set' || pwDialog?.mode === 'change') {
        const fp = await doSaveWithPw(password || undefined);
        if (fp) snack?.show(`已保存: ${fp.split(/[/\\]/).pop()}`);
      } else if (pwDialog?.mode === 'clear') {
        delete p.projectJson.userPassword;
        snack?.show('密码已清除');
      }
      setPwDialog(null);
    },
    [pwDialog, snack],
  );

  // ── Project save / open / new ──

  const doSave = useCallback(async () => {
    const p = projectRef.current;
    if (!p) return null;
    return p.save();
  }, []);

  const doSaveAs = useCallback(async () => {
    const p = projectRef.current;
    if (!p) return null;
    return p.saveAs();
  }, []);

  const handleSave = useCallback(async () => {
    if (!window.electron?.project) {
      snack?.show('保存失败：请使用 Electron 环境运行');
      return;
    }
    const pj = projectRef.current!.projectJson;
    if (!pj.userPassword && !pj.skipSetPasswordPrompt) {
      pendingPwActionRef.current = 'save';
      setPwDialog({ mode: 'askSet' });
      return;
    }
    const fp = await doSave();
    if (fp) snack?.show(`已保存: ${fp.split(/[/\\]/).pop()}`);
  }, [snack, doSave]);

  const handleSaveAs = useCallback(async () => {
    if (!window.electron?.project) {
      snack?.show('保存失败：请使用 Electron 环境运行');
      return;
    }
    const pj = projectRef.current!.projectJson;
    if (!pj.userPassword && !pj.skipSetPasswordPrompt) {
      pendingPwActionRef.current = 'saveAs';
      setPwDialog({ mode: 'askSet' });
      return;
    }
    if (pj.userPassword && !pj.skipChangePasswordPrompt) {
      pendingPwActionRef.current = 'saveAs';
      setPwDialog({ mode: 'askChange' });
      return;
    }
    const fp = await doSaveAs();
    if (fp) snack?.show(`已保存: ${fp.split(/[/\\]/).pop()}`);
  }, [snack, doSaveAs]);

  const pendingOpenPathRef = useRef<string | null>(null);

  const doOpen = useCallback(async () => {
    if (!window.electron?.project) {
      snack?.show('打开失败：请使用 Electron 环境运行');
      return;
    }
    const result = await Project.open();
    if (!result) return;
    if ('error' in result) {
      pendingOpenPathRef.current = result.filePath;
      setPwDialog({ mode: 'enter' });
      return;
    }
    projectRef.current = result.project;
    setIsProjectOpen(true);
    undoManager.clear();
    undoManager.record(projectRef.current!);
    addRecentFile(result.filePath);
    setAudioEngine(null);
    setAudioDuration(0);
    setAudioFileName('');
    setRenderVersion((v) => v + 1);
    snack?.show(`已打开: ${result.filePath.split(/[/\\]/).pop()}`);
  }, [snack]);

  const handleOpen = useCallback(() => {
    if (isProjectOpen && projectRef.current?.hasUnsavedChanges) {
      setConfirmDialog({
        title: '打开项目',
        message: '当前项目未保存',
        confirmLabel: '保存',
        cancelLabel: '取消',
        extraLabel: '不保存',
        onConfirm: async () => {
          setConfirmDialog(null);
          await handleSave();
          doOpen();
        },
        onCancel: () => setConfirmDialog(null),
        onExtra: () => {
          setConfirmDialog(null);
          doOpen();
        },
      });
    } else {
      doOpen();
    }
  }, [doOpen, isProjectOpen, handleSave]);

  const doNew = useCallback(() => {
    const lyrics = new Lyrics();
    for (const w of [
      'Hello',
      ' ',
      'World',
      '\n',
      'あ',
      'た',
      'し',
      'は',
      'ネ',
      'コ',
      'カ',
      'ラ',
      'な',
      'の',
      'にゃ',
      '\n',
    ]) {
      if (w === ' ') {
        lyrics.words.push(createSpaceWord());
      } else if (w === '\n') {
        lyrics.words.push(createNewlineWord());
      } else {
        lyrics.words.push(createUnsetWord(w));
      }
    }
    const timing = createTimingState();
    const p = new Project(lyrics, timing);
    projectRef.current = p;
    setIsProjectOpen(true);
    undoManager.clear();
    undoManager.record(p);
    setRenderVersion((v) => v + 1);
  }, [undoManager]);

  const handleNew = useCallback(() => {
    if (isProjectOpen && projectRef.current?.hasUnsavedChanges) {
      setConfirmDialog({
        title: '新建项目',
        message: '当前项目未保存',
        confirmLabel: '保存',
        cancelLabel: '取消',
        extraLabel: '不保存',
        onConfirm: async () => {
          setConfirmDialog(null);
          await handleSave();
          doNew();
        },
        onCancel: () => setConfirmDialog(null),
        onExtra: () => {
          setConfirmDialog(null);
          doNew();
        },
      });
    } else {
      doNew();
    }
  }, [doNew, isProjectOpen, handleSave]);

  const doClose = useCallback(() => {
    undoManager.clear();
    projectRef.current = null;
    setIsProjectOpen(false);
    setRenderVersion(0);
    setCurrentView('project');
    setAudioEngine(null);
    setAudioDuration(0);
    setAudioFileName('');
  }, [
    setIsProjectOpen,
    setRenderVersion,
    setCurrentView,
    setAudioEngine,
    setAudioDuration,
    setAudioFileName,
  ]);

  const handleClose = useCallback(() => {
    if (isProjectOpen && projectRef.current?.hasUnsavedChanges) {
      setConfirmDialog({
        title: '关闭项目',
        message: '当前项目未保存',
        confirmLabel: '保存',
        cancelLabel: '取消',
        extraLabel: '不保存',
        onConfirm: async () => {
          setConfirmDialog(null);
          await handleSave();
          doClose();
        },
        onCancel: () => setConfirmDialog(null),
        onExtra: () => {
          setConfirmDialog(null);
          doClose();
        },
      });
    } else {
      doClose();
    }
  }, [doClose, isProjectOpen, handleSave]);

  const doWindowClose = useCallback(() => {
    if (window.electron?.window?.forceClose)
      window.electron.window.forceClose();
    else window.close();
  }, []);

  const handleExit = useCallback(() => {
    if (isProjectOpen && projectRef.current?.hasUnsavedChanges) {
      setConfirmDialog({
        title: '退出',
        message: '当前项目未保存',
        confirmLabel: '保存并退出',
        cancelLabel: '取消',
        extraLabel: '不保存',
        onConfirm: async () => {
          setConfirmDialog(null);
          await handleSave();
          doWindowClose();
        },
        onCancel: () => setConfirmDialog(null),
        onExtra: () => {
          setConfirmDialog(null);
          doWindowClose();
        },
      });
    } else {
      doWindowClose();
    }
  }, [isProjectOpen, handleSave, doWindowClose]);

  const handleUndoRecord = useCallback(() => {
    const p = projectRef.current;
    if (!p) return;
    p.hasUnsavedChanges = true;
    undoManager.record(p);
  }, [undoManager]);

  const handleUndo = useCallback(() => {
    const p = projectRef.current;
    if (!p) return false;
    const ok = undoManager.undo(p);
    if (ok) {
      p.hasUnsavedChanges = true;
      setRenderVersion((v) => v + 1);
    }
    return ok;
  }, [undoManager]);

  const handleRedo = useCallback(() => {
    const p = projectRef.current;
    if (!p) return false;
    const ok = undoManager.redo(p);
    if (ok) {
      p.hasUnsavedChanges = true;
      setRenderVersion((v) => v + 1);
    }
    return ok;
  }, [undoManager]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        handleRedo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
        e.preventDefault();
        handleOpen();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        handleNew();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'q') {
        e.preventDefault();
        handleExit();
      } else if (e.key === 'Escape') {
        setPwDialog(null);
        setConfirmDialog(null);
      }
    };
    document.addEventListener('keydown', handler);
    let unsubRequestClose: (() => void) | undefined;
    if (window.electron?.window?.onRequestClose) {
      unsubRequestClose = window.electron.window.onRequestClose(() => {
        handleExit();
      });
    }
    return () => {
      document.removeEventListener('keydown', handler);
      unsubRequestClose?.();
    };
  }, [handleUndo, handleRedo, handleSave, handleOpen, handleNew, handleExit]);

  return (
    <div className="app-root">
      <TopBar
        currentView={currentView}
        onViewChange={setCurrentView}
        hasProject={isProjectOpen}
        onExit={handleExit}
      />
      {currentView === 'project' ? (
        <ProjectView
          project={projectRef.current}
          hasUserPassword={!!projectRef.current?.projectJson.userPassword}
          onNew={handleNew}
          onOpen={handleOpen}
          onSave={handleSave}
          onSaveAs={handleSaveAs}
          onClose={handleClose}
          onSetPassword={() =>
            setPwDialog({
              mode: projectRef.current?.projectJson.userPassword
                ? 'change'
                : 'set',
            })
          }
          onClearPassword={() => {
            if (!projectRef.current?.projectJson.userPassword) {
              snack?.show('当前项目未设置密码');
              return;
            }
            setPwDialog({ mode: 'clear' });
          }}
          recentFiles={recentFiles}
          onOpenRecent={async (filePath) => {
            if (!window.electron?.project) {
              snack?.show('打开失败：请使用 Electron 环境运行');
              return;
            }
            const result = await window.electron.project.openPath(filePath);
            if (!result) return;
            if ('error' in result) {
              pendingOpenPathRef.current = filePath;
              setPwDialog({ mode: 'enter' });
              return;
            }
            const lyrics = fromJson(result.lyrics);
            const timing = deserializeTimingState(result.timing);
            const p = new Project(lyrics, timing);
            p.filePath = result.filePath;
            p.projectJson = result.projectJson || {
              version: APP_VERSION,
              createdAt: '',
              updatedAt: '',
            };
            p.hasUnsavedChanges = false;
            projectRef.current = p;
            setIsProjectOpen(true);
            addRecentFile(result.filePath);
            setAudioEngine(null);
            setAudioDuration(0);
            setAudioFileName('');
            setRenderVersion((v) => v + 1);
            snack?.show(`已打开: ${result.filePath.split(/[/\\]/).pop()}`);
          }}
        />
      ) : currentView === 'editor' ? (
        <LyricsEditor
          lyrics={lyrics}
          onUndoRecord={handleUndoRecord}
          onUndo={handleUndo}
          onRedo={handleRedo}
          canUndo={undoManager.canUndo.bind(undoManager)}
          canRedo={undoManager.canRedo.bind(undoManager)}
          snack={snack}
          onLyricsChange={handleLyricsChange}
        />
      ) : (
        <TimingView
          lyrics={lyrics}
          state={timing}
          onStateChange={(next) => {
            if (projectRef.current) projectRef.current.timing = next;
            setRenderVersion((v) => v + 1);
          }}
          onUndoRecord={handleUndoRecord}
          onUndo={handleUndo}
          onRedo={handleRedo}
          canUndo={undoManager.canUndo.bind(undoManager)}
          canRedo={undoManager.canRedo.bind(undoManager)}
          renderVersion={renderVersion}
          onRequestRender={handleLyricsChange}
          snack={snack}
          audioEngine={audioEngine}
          audioDuration={audioDuration}
          audioFileName={audioFileName}
          onAudioChange={handleAudioChange}
        />
      )}
      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          cancelLabel={confirmDialog.cancelLabel}
          extraLabel={confirmDialog.extraLabel}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => {
            confirmDialog.onCancel?.();
            setConfirmDialog(null);
          }}
          onExtra={confirmDialog.onExtra}
        />
      )}
      {pwDialog && (
        <PasswordDialog
          mode={pwDialog.mode}
          onConfirm={handlePwConfirm}
          onCancel={() => setPwDialog(null)}
          onYes={(dontAsk) => {
            const nextMode = pwDialog.mode === 'askChange' ? 'change' : 'set';
            if (dontAsk) {
              const pj = projectRef.current!.projectJson;
              if (pwDialog.mode === 'askChange')
                pj.skipChangePasswordPrompt = true;
              else pj.skipSetPasswordPrompt = true;
            }
            setPwDialog(null);
            setTimeout(() => setPwDialog({ mode: nextMode }), 0);
          }}
          snack={snack}
          storedPassword={
            pwDialog.mode === 'change' || pwDialog.mode === 'clear'
              ? projectRef.current?.projectJson.userPassword
              : undefined
          }
        />
      )}
      {snackNode}
    </div>
  );
}
