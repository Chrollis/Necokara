import { useState, useCallback, useEffect, useRef } from 'react';
import { Project, APP_VERSION } from '../../project/project';
import { UndoManager } from '../../project/undo-manager';
import { Lyrics } from '../../editor/lyrics';
import {
  createUnsetWord,
  createSpaceWord,
  createNewlineWord,
} from '../../editor/word';
import { createTimingState } from '../../timing/state';
import { fromJson } from '../../editor/jsonlyrics';
import { deserializeTimingState } from '../../timing/serialization';
import type AudioEngine from '../../features/timing/AudioEngine';
import type { PwDialogMode, ConfirmDialogState } from './useDialogs';

export interface UseProjectActionsOptions {
  snack?: { show: (msg: string, durationMs?: number) => void };
  addRecentFile: (filePath: string) => void;
  pwDialog: { mode: PwDialogMode } | null;
  setPwDialog: (d: { mode: PwDialogMode } | null) => void;
  setConfirmDialog: (d: ConfirmDialogState | null) => void;
  pendingPwActionRef: React.MutableRefObject<'save' | 'saveAs'>;
  pendingOpenPathRef: React.MutableRefObject<string | null>;
  setAudioEngine: (e: AudioEngine | null) => void;
  setAudioDuration: (d: number) => void;
  setAudioFileName: (n: string) => void;
}

export interface UseProjectActionsReturn {
  projectRef: React.MutableRefObject<Project | null>;
  isProjectOpen: boolean;
  setIsProjectOpen: (v: boolean) => void;
  renderVersion: number;
  setRenderVersion: (v: React.SetStateAction<number>) => void;
  currentView: 'project' | 'editor' | 'timing';
  setCurrentView: (v: 'project' | 'editor' | 'timing') => void;
  undoManager: UndoManager;
  handleSave: () => Promise<void>;
  handleSaveAs: () => Promise<void>;
  handleOpen: () => void;
  handleNew: () => void;
  handleClose: () => void;
  handleExit: () => void;
  handleUndoRecord: () => void;
  handleUndo: () => boolean;
  handleRedo: () => boolean;
  handlePwConfirm: (password?: string, dontAskAgain?: boolean) => Promise<void>;
}

export default function useProjectActions(
  opts: UseProjectActionsOptions,
): UseProjectActionsReturn {
  const {
    snack,
    addRecentFile,
    pwDialog,
    setPwDialog,
    setConfirmDialog,
    pendingPwActionRef,
    pendingOpenPathRef,
    setAudioEngine,
    setAudioDuration,
    setAudioFileName,
  } = opts;

  const projectRef = useRef<Project | null>(null);
  const [isProjectOpen, setIsProjectOpen] = useState(false);
  const [renderVersion, setRenderVersion] = useState(0);
  const [currentView, setCurrentView] = useState<
    'project' | 'editor' | 'timing'
  >('project');
  const [undoManager] = useState(() => new UndoManager());

  // ── Save ──

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
  }, [snack, doSave, pendingPwActionRef, setPwDialog]);

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
  }, [snack, doSaveAs, pendingPwActionRef, setPwDialog]);

  // ── Open ──

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
  }, [
    snack,
    addRecentFile,
    undoManager,
    pendingOpenPathRef,
    setPwDialog,
    setAudioEngine,
    setAudioDuration,
    setAudioFileName,
  ]);

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
  }, [doOpen, isProjectOpen, handleSave, setConfirmDialog]);

  // ── New ──

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
      if (w === ' ') lyrics.words.push(createSpaceWord());
      else if (w === '\n') lyrics.words.push(createNewlineWord());
      else lyrics.words.push(createUnsetWord(w));
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
  }, [doNew, isProjectOpen, handleSave, setConfirmDialog]);

  // ── Close ──

  const doClose = useCallback(() => {
    undoManager.clear();
    projectRef.current = null;
    setIsProjectOpen(false);
    setRenderVersion(0);
    setCurrentView('project');
    setAudioEngine(null);
    setAudioDuration(0);
    setAudioFileName('');
  }, [undoManager, setAudioEngine, setAudioDuration, setAudioFileName]);

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
  }, [doClose, isProjectOpen, handleSave, setConfirmDialog]);

  // ── Exit ──

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
  }, [isProjectOpen, handleSave, doWindowClose, setConfirmDialog]);

  // ── Undo / Redo ──

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

  // ── Password confirm ──

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
      if (
        pwDialog &&
        (pwDialog.mode === 'askSet' || pwDialog.mode === 'askChange')
      ) {
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
        const newProject = new Project(lyrics, timing);
        if (password) newProject.projectJson.userPassword = password;
        newProject.filePath = result.filePath;
        newProject.projectJson = result.projectJson || {
          version: APP_VERSION,
          createdAt: '',
          updatedAt: '',
        };
        newProject.hasUnsavedChanges = false;
        projectRef.current = newProject;
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
    [
      snack,
      setPwDialog,
      pendingPwActionRef,
      pendingOpenPathRef,
      setAudioEngine,
      setAudioDuration,
      setAudioFileName,
    ],
  );

  return {
    projectRef,
    isProjectOpen,
    setIsProjectOpen,
    renderVersion,
    setRenderVersion,
    currentView,
    setCurrentView,
    undoManager,
    handleSave,
    handleSaveAs,
    handleOpen,
    handleNew,
    handleClose,
    handleExit,
    handleUndoRecord,
    handleUndo,
    handleRedo,
    handlePwConfirm,
  };
}
