import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import '@mdi/font/css/materialdesignicons.css';
import '../styles/toolbar.css';
import '../styles/context-menu.css';
import '../styles/bottom-bar.css';
import './App.css';
import LyricsEditor from '../features/editor/LyricsEditor';
import TimingView from '../features/timing/TimingView';
import ProjectView from '../features/project/ProjectView';
import ResourceConfigView from '../features/resources/ResourceConfigView';
import TopBar from './TopBar';
import PasswordDialog from './PasswordDialog';
import ConfirmDialog from './ConfirmDialog';
import { Project, APP_VERSION } from '../project/project';
import { Lyrics } from '../editor/lyrics';
import { createTimingState } from '../timing/state';
import { fromJson } from '../editor/jsonlyrics';
import { deserializeTimingState } from '../timing/serialization';
import { useSnackBar } from './SnackBar';
import AudioEngine from '../features/timing/AudioEngine';
import useRecentFiles from './hooks/useRecentFiles';
import useDialogs from './hooks/useDialogs';
import useProjectActions from './hooks/useProjectActions';
import { useUpdater } from './hooks/useUpdater';
import { TimingRuntimeProvider } from './store/timingRuntime';

export default function App() {
  const [currentView, setCurrentView] = useState<
    'project' | 'editor' | 'timing' | 'resources'
  >('project');
  const [snack, snackNode] = useSnackBar();
  const { status: updateStatus, installUpdate } = useUpdater(snack);
  const { recentFiles, addRecentFile } = useRecentFiles();

  const {
    pwDialog,
    setPwDialog,
    confirmDialog,
    setConfirmDialog,
    pendingPwActionRef,
    pendingOpenPathRef,
  } = useDialogs();

  const [audioEngine, setAudioEngine] = useState<AudioEngine | null>(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioFileName, setAudioFileName] = useState('');
  const [projectKey, setProjectKey] = useState(0);
  const [detectingBpm, setDetectingBpm] = useState(false);
  const [autoTimingBusy, setAutoTimingBusy] = useState(false);
  const [bpmProgress, setBpmProgress] = useState<number>(-1);
  const [autoTimingProgress, setAutoTimingProgress] = useState<number>(-1);
  const [autoTimingStage, setAutoTimingStage] = useState<
    'separate' | 'align' | null
  >(null);
  // Backend validation in progress. Lifted to App so it survives page
  // switches (ResourceConfigView unmounts when leaving the resources page)
  // and reflects the startup warm-up even before that page is opened.
  const [validating, setValidating] = useState(false);

  const handleProjectChange = useCallback(() => {
    setProjectKey((k) => k + 1);
  }, []);

  const {
    projectRef,
    isProjectOpen,
    setIsProjectOpen,
    renderVersion,
    setRenderVersion,
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
  } = useProjectActions({
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
    onProjectChange: handleProjectChange,
  });

  const lyrics = projectRef.current?.lyrics ?? new Lyrics();
  const timing = projectRef.current?.timing ?? createTimingState();

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

  // Destroy old AudioEngine when a new one is set
  useEffect(() => {
    return () => {
      if (audioEngine) audioEngine.destroy();
    };
  }, [audioEngine]);

  // Keyboard shortcuts
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
    <TimingRuntimeProvider
      audioEngine={audioEngine}
      audioDuration={audioDuration}
    >
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
            updateStatus={updateStatus}
            onInstallUpdate={installUpdate}
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
            onClearPassword={() => setPwDialog({ mode: 'clear' })}
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
              undoManager.record(p);
              handleProjectChange();
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
            key={projectKey}
            lyrics={lyrics}
            onUndoRecord={handleUndoRecord}
            onUndo={handleUndo}
            onRedo={handleRedo}
            canUndo={undoManager.canUndo.bind(undoManager)}
            canRedo={undoManager.canRedo.bind(undoManager)}
            snack={snack}
            onLyricsChange={handleLyricsChange}
          />
        ) : currentView === 'resources' ? (
          <ResourceConfigView
            updateStatus={updateStatus}
            onInstallUpdate={installUpdate}
            validating={validating}
            onValidatingChange={setValidating}
          />
        ) : (
          <TimingView
            key={projectKey}
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
            detectingBpm={detectingBpm}
            onDetectingBpmChange={setDetectingBpm}
            autoTimingBusy={autoTimingBusy}
            onAutoTimingBusyChange={setAutoTimingBusy}
            autoTimingProgress={autoTimingProgress}
            onAutoTimingProgressChange={setAutoTimingProgress}
            autoTimingStage={autoTimingStage}
            onAutoTimingStageChange={setAutoTimingStage}
            bpmProgress={bpmProgress}
            onBpmProgressChange={setBpmProgress}
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
    </TimingRuntimeProvider>
  );
}
