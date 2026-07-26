import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { Lyrics } from '../../editor/lyrics';
import type { TimingState } from '../../timing/types';
import { buildTimingView } from '../../timing/view';
import { moveToBeat, moveToNextBeat, moveToPrevBeat, setBeatTime, clearBeatTime, postSetBeat } from '../../timing/operations';
import inferSeparatorTimes from '../../timing/separator';
import { setSyllableTime, unsetSyllableTime } from '../../editor/syllable';
import { parseTime, formatTime } from '../../editor/time';
import { UndoManager } from '../../shared/undo-manager';
import AudioEngine from './AudioEngine';
import Waveform from './Waveform';
import TimeRuler from './TimeRuler';
import { TimingWordCard, TriangleGroup, MultiLineView } from './LyricsView';
import './timing.css';

interface TimingViewProps {
  lyrics: Lyrics;
  state: TimingState;
  onStateChange?: (state: TimingState) => void;
  undoManager: UndoManager;
  renderVersion: number;
  onRequestRender?: () => void;
  snack?: { show: (msg: string, durationMs?: number) => void };
  audioEngine: AudioEngine | null;
  audioDuration: number;
  audioFileName: string;
  onAudioChange: (engine: AudioEngine | null, duration: number, fileName: string) => void;
}

export default function TimingView({
  lyrics, state, onStateChange, undoManager, renderVersion, onRequestRender, snack,
  audioEngine, audioDuration, audioFileName, onAudioChange,
}: TimingViewProps) {
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const currentTimeRef = useRef(0);
  // zoom: 1x = full song visible, higher = zoomed in
  // max zoom so viewport shows at least 2 seconds
  const [zoomLevel, setZoomLevel] = useState(1);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [compensationMs, setCompensationMs] = useState(0);
  const [verticalZoom, setVerticalZoom] = useState(1);
  const [verticalOffset, setVerticalOffset] = useState(0);
  const [multiLine, setMultiLine] = useState(false);
  const [speed, setSpeed] = useState(1.0);
  const [speedInputOpen, setSpeedInputOpen] = useState(false);
  const [compInputOpen, setCompInputOpen] = useState(false);
  const [editingBeatIndex, setEditingBeatIndex] = useState<number | null>(null);
  const [editingWordIndex, setEditingWordIndex] = useState<number | null>(null);
  const [editingTimeValue, setEditingTimeValue] = useState('');
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [cardCtxMenu, setCardCtxMenu] = useState<{
    x: number;
    y: number;
    beatIndex: number;
    wordIndex?: number;
    isSet: boolean;
  } | null>(null);
  const compInputRef = useRef<HTMLInputElement>(null);
  const speedInputRef = useRef<HTMLInputElement>(null);
  const editTimeRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const animRef = useRef<number>(0);
  const lyricsRef = useRef<HTMLDivElement>(null);
  const columnsRowRef = useRef<HTMLDivElement>(null);

  const fmtSec = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  const updateState = useCallback((next: TimingState) => {
    onStateChange?.(next);
  }, [onStateChange]);

  // Playback animation loop
  useEffect(() => {
    if (!isPlaying) {
      cancelAnimationFrame(animRef.current);
      return;
    }
    const tick = () => {
      if (!audioEngine) return;
      const now = audioEngine.getCurrentTime();
      if (now >= audioDuration - 10) {
        audioEngine.pause();
        setIsPlaying(false);
        setCurrentTime(audioDuration);
        return;
      }
      currentTimeRef.current = now;
      setCurrentTime(now);
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [isPlaying, audioEngine, audioDuration]);

  // Sync scroll offset when zoom changes
  useEffect(() => {
    const maxScroll = Math.max(0, audioDuration - audioDuration / zoomLevel);
    setScrollOffset((s) => Math.min(s, maxScroll));
  }, [zoomLevel, audioDuration]);

  // Keep playhead visible during playback
  useEffect(() => {
    if (!isPlaying) return;
    const visibleMs = audioDuration / zoomLevel;
    if (currentTime < scrollOffset || currentTime > scrollOffset + visibleMs) {
      setScrollOffset(Math.max(0, currentTime - visibleMs * 0.2));
    }
  }, [currentTime, isPlaying, audioDuration, zoomLevel, scrollOffset]);

  // Collect beat times for waveform markers
  const beatTimesMs = useMemo(() => {
    const times: number[] = [];
    lyrics.getBeatRefs().forEach((ref) => {
      const syl = lyrics.words[ref.wordIndex].syllables[ref.sylIndex];
      if (syl.isSet) times.push(syl.time.msec);
    });
    return times;
  }, [lyrics, renderVersion]);

  const selectedBeatTimeMs = useMemo(() => {
    const refs = lyrics.getBeatRefs();
    const idx = state.selectedBeatIndex;
    if (idx < 0 || idx >= refs.length) return null;
    const syl = lyrics.words[refs[idx].wordIndex].syllables[refs[idx].sylIndex];
    return syl.isSet ? syl.time.msec : null;
  }, [lyrics, state.selectedBeatIndex, renderVersion]);

  const viewData = useMemo(() => buildTimingView(lyrics, { ...state, currentPlayheadMs: currentTime }), [lyrics, state, currentTime, renderVersion]);

  // ── Audio handlers ──

  const handleImportAudio = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const engine = new AudioEngine();
      await engine.loadFile(file);
      engine.setPlaybackRate(speed);
      onAudioChange(engine, engine.duration, file.name);
      setCurrentTime(0);
      currentTimeRef.current = 0;
    } catch (err) {
      snack?.show('音频加载失败');
      console.error(err);
    }
  }, [onAudioChange, snack]);

  const handleSeek = useCallback((timeMs: number) => {
    const clamped = Math.max(0, Math.min(timeMs, audioDuration));
    currentTimeRef.current = clamped;
    setCurrentTime(clamped);
    audioEngine?.seek(clamped);
  }, [audioDuration, audioEngine]);

  const togglePlay = useCallback(() => {
    if (!audioEngine) return;
    if (isPlaying) {
      audioEngine.pause();
      setIsPlaying(false);
    } else {
      if (currentTimeRef.current >= audioDuration - 50) {
        handleSeek(0);
      }
      audioEngine.play();
      setIsPlaying(true);
    }
  }, [audioEngine, audioDuration, handleSeek, isPlaying]);

  // Sync playback rate to audio engine
  useEffect(() => {
    audioEngine?.setPlaybackRate(speed);
  }, [audioEngine, speed]);

  // ── Beat operations ──

  const handleSetBeat = useCallback(() => {
    if (!audioEngine) return;
    const refs = lyrics.getBeatRefs();
    const idx = state.selectedBeatIndex;
    // If already set, just advance without recording
    if (idx >= 0 && idx < refs.length) {
      const syl = lyrics.words[refs[idx].wordIndex].syllables[refs[idx].sylIndex];
      if (syl.isSet) {
        updateState(moveToNextBeat(state, lyrics));
        return;
      }
    }
    undoManager.record(lyrics);
    setBeatTime(lyrics, state, Math.round(currentTime + compensationMs));
    const ns = postSetBeat(lyrics, state, idx);
    updateState(moveToNextBeat(ns, lyrics));
  }, [lyrics, state, updateState, undoManager, currentTime, compensationMs, audioEngine]);

  const handleClearBeat = useCallback(() => {
    const refs = lyrics.getBeatRefs();
    const idx = state.selectedBeatIndex;
    // If already unset, just go back without doing anything
    if (idx >= 0 && idx < refs.length) {
      const syl = lyrics.words[refs[idx].wordIndex].syllables[refs[idx].sylIndex];
      if (!syl.isSet) {
        updateState(moveToPrevBeat(state));
        return;
      }
    }
    undoManager.record(lyrics);
    clearBeatTime(lyrics, state);
    let ns = moveToPrevBeat(state);
    ns = postSetBeat(lyrics, ns, idx);
    updateState(ns);
  }, [lyrics, state, updateState, undoManager]);

  // Scan all separator times (called on mount / view switch)
  const scanAllSeparators = useCallback((lyr: Lyrics) => {
    const beatRefs = lyr.getBeatRefs();
    beatRefs.forEach((ref, i) => {
      const syl = lyr.words[ref.wordIndex].syllables[ref.sylIndex];
      if (syl.isSet) {
        inferSeparatorTimes(lyr, i);
      }
    });
  }, []);

  // Scan all separator times on mount (initial load / view switch)
  useEffect(() => {
    scanAllSeparators(lyrics);
    // mount-only
  }, []);

  // Keyboard: shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === ' ') {
        e.preventDefault();
        handleSetBeat();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleSetBeat();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        handleClearBeat();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        updateState(moveToNextBeat(state, lyrics));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        updateState(moveToPrevBeat(state));
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        setVerticalZoom((z) => Math.max(0.1, z - 0.2));
      } else if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        setVerticalZoom((z) => Math.min(5, z + 0.2));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setVerticalOffset((o) => o + 10);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setVerticalOffset((o) => o - 10);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handleSetBeat, handleClearBeat, togglePlay, state, lyrics, updateState, setVerticalZoom, setVerticalOffset]);

  // ── Beat navigation ──

  const handleClickBeat = useCallback((beatIndex: number) => {
    const ns = moveToBeat(state, beatIndex, lyrics);
    updateState(ns);
    // Prevent auto-scroll during playback (conflicts with playhead tracking)
    if (isPlaying) return;
    // Auto-scroll waveform to selected beat
    const refs = lyrics.getBeatRefs();
    if (beatIndex >= 0 && beatIndex < refs.length) {
      const ref = refs[beatIndex];
      const syl = lyrics.words[ref.wordIndex].syllables[ref.sylIndex];
      if (syl.isSet) {
        const beatMs = syl.time.msec;
        const visibleMs = audioDuration / zoomLevel;
        const margin = visibleMs * 0.15;
        if (beatMs < scrollOffset || beatMs > scrollOffset + visibleMs - margin) {
          setScrollOffset(Math.max(0, beatMs - visibleMs * 0.3));
        }
      }
    }
  }, [state, lyrics, updateState, audioDuration, zoomLevel, scrollOffset, isPlaying]);

  const handleClickWord = useCallback((wordIndex: number) => {
    const beatRefs = lyrics.getBeatRefs();
    // Find first beat in this word
    let bi = 0;
    for (const ref of beatRefs) {
      if (ref.wordIndex >= wordIndex) break;
      bi += 1;
    }
    if (bi >= 0 && bi < beatRefs.length) {
      handleClickBeat(bi);
    }
  }, [lyrics, handleClickBeat]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      // Logarithmic zoom: factor per scroll tick
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      setZoomLevel((z) => {
        const minZ = 1;
        const maxZ = Math.max(1, audioDuration / 2000);
        return Math.max(minZ, Math.min(maxZ, z * factor));
      });
    } else {
      const visibleMs = Math.max(1, audioDuration / zoomLevel);
      const maxScroll = Math.max(0, audioDuration - visibleMs);
      setScrollOffset((s) => {
        const dir = e.deltaY > 0 ? 1 : -1;
        return Math.max(0, Math.min(maxScroll, s + dir * visibleMs / 5));
      });
    }
  }, [audioDuration, zoomLevel]);

  const handleFinishEditComp = useCallback(() => {
    setCompInputOpen(false);
  }, []);

  const handleCompKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter') handleFinishEditComp();
  }, [handleFinishEditComp]);

  // Auto-scroll lyrics to keep selected beat visible
  // Only scrolls when the element is fully out of view, and positions
  // it at ~1/3 from the start (leaving context before + room ahead).
  useEffect(() => {
    if (state.selectedBeatIndex < 0) return;

    // Multi-line: try data-beat-index first
    const multiEl = lyricsRef.current?.querySelector(`[data-beat-index="${state.selectedBeatIndex}"]`);
    if (multiEl && lyricsRef.current) {
      const conta = lyricsRef.current;
      const crect = conta.getBoundingClientRect();
      const er = multiEl.getBoundingClientRect();
      const margin = 8;
      // Only scroll if fully out of view vertically
      if (er.bottom < crect.top + margin || er.top > crect.bottom - margin) {
        conta.scrollTo({
          top: conta.scrollTop + (er.top - crect.top) - crect.height * 0.33,
          behavior: 'smooth',
        });
      }
      return;
    }

    // Single-line: find by word index
    const wordIdx = viewData.findIndex(wi =>
      wi.syllables.some(s => s.beatIndex === state.selectedBeatIndex)
    );
    if (wordIdx < 0) return;
    const singleEl = lyricsRef.current?.querySelector(`[data-word-index="${wordIdx}"]`);
    if (!singleEl || !columnsRowRef.current) return;
    const conta = columnsRowRef.current;
    const crect = conta.getBoundingClientRect();
    const er = singleEl.getBoundingClientRect();
    const margin = 8;
    // Only scroll if fully out of view horizontally
    if (er.right < crect.left + margin || er.left > crect.right - margin) {
      conta.scrollTo({
        left: conta.scrollLeft + (er.left - crect.left) - crect.width * 0.33,
        behavior: 'smooth',
      });
    }
  }, [state.selectedBeatIndex, viewData]);

  // ── Double-click time editing ──

  const handleDoubleClickTime = useCallback((beatIndex: number, optWordIndex?: number) => {
    let syl: { isSet: boolean; time: { msec: number } };
    if (optWordIndex !== undefined) {
      // Separator: access by word index
      syl = lyrics.words[optWordIndex].syllables[0];
    } else {
      const refs = lyrics.getBeatRefs();
      if (beatIndex < 0 || beatIndex >= refs.length) return;
      const ref = refs[beatIndex];
      syl = lyrics.words[ref.wordIndex].syllables[ref.sylIndex];
    }
    const timeStr = syl.isSet
      ? formatTime({ msec: syl.time.msec }, '.', false, false)
      : '0:00.000';
    setEditingBeatIndex(beatIndex);
    setEditingWordIndex(optWordIndex ?? null);
    setEditingTimeValue(timeStr);
    setTimeout(() => editTimeRef.current?.focus(), 0);
  }, [lyrics]);

  const handleFinishEditTime = useCallback(() => {
    if (editingBeatIndex === null) return;
    const raw = editingTimeValue.trim();
    if (raw.length === 0) {
      setEditingBeatIndex(null);
      setEditingWordIndex(null);
      return;
    }
    const parsed = parseTime(raw);
    // Invalid: parseTime returns 0 and input contains no digits
    if (parsed.msec === 0 && !/[0-9]/.test(raw)) {
      snack?.show('时间格式无效');
      setEditingBeatIndex(null);
      setEditingWordIndex(null);
      return;
    }
    // Valid
    if (editingWordIndex !== null) {
      // Separator edit
      const word = lyrics.words[editingWordIndex];
      undoManager.record(lyrics);
      setSyllableTime(word.syllables[0], parsed);
      // Update state to clear any pending beats related to this separator
      updateState({ ...state });
    } else if (editingBeatIndex >= 0) {
      // Regular beat edit — triggers separator inference via postSetBeat
      const stateWithBeat = { ...state, selectedBeatIndex: editingBeatIndex };
      undoManager.record(lyrics);
      setBeatTime(lyrics, stateWithBeat, parsed.msec);
      const ns = postSetBeat(lyrics, stateWithBeat, editingBeatIndex);
      if (ns !== stateWithBeat) updateState(ns);
    }
    setEditingBeatIndex(null);
    setEditingWordIndex(null);
  }, [editingBeatIndex, editingWordIndex, editingTimeValue, lyrics, state, undoManager, snack, updateState]);

  const handleEditTimeBlur = useCallback(() => {
    handleFinishEditTime();
  }, [handleFinishEditTime]);

  const handleEditTimeKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      setEditingBeatIndex(null);
    }
  }, []);

  // ── Context menu ──

  const ctxMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ctxMenu) return;
    const handler = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ctxMenu]);

  const handleCtxAction = useCallback((action: () => void) => {
    setCtxMenu(null);
    action();
  }, []);

  // ── Card context menu ──

  const cardCtxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!cardCtxMenu) return;
    const handler = (e: MouseEvent) => {
      if (cardCtxRef.current && !cardCtxRef.current.contains(e.target as Node)) {
        setCardCtxMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [cardCtxMenu]);

  const handleCardCtxAction = useCallback((action: () => void) => {
    setCardCtxMenu(null);
    action();
  }, []);

  const handleCardCtxReset = useCallback(() => {
    if (!cardCtxMenu) return;
    undoManager.record(lyrics);
    if (cardCtxMenu.wordIndex !== undefined) {
      const word = lyrics.words[cardCtxMenu.wordIndex];
      unsetSyllableTime(word.syllables[0]);
    } else {
      clearBeatTime(lyrics, { ...state, selectedBeatIndex: cardCtxMenu.beatIndex });
    }
    setCardCtxMenu(null);
    onRequestRender?.();
  }, [cardCtxMenu, lyrics, state, undoManager, onRequestRender]);

  const handleCardCtxShift = useCallback((delta: number) => {
    if (!cardCtxMenu) return;
    undoManager.record(lyrics);
    if (cardCtxMenu.wordIndex !== undefined) {
      const word = lyrics.words[cardCtxMenu.wordIndex];
      const syl = word.syllables[0];
      const current = syl.isSet ? syl.time.msec : 0;
      setSyllableTime(syl, { msec: Math.max(0, current + delta) });
    } else {
      const refs = lyrics.getBeatRefs();
      const ref = refs[cardCtxMenu.beatIndex];
      const syl = lyrics.words[ref.wordIndex].syllables[ref.sylIndex];
      const current = syl.isSet ? syl.time.msec : 0;
      setSyllableTime(syl, { msec: Math.max(0, current + delta) });
    }
    setCardCtxMenu(null);
    onRequestRender?.();
  }, [cardCtxMenu, lyrics, undoManager, onRequestRender]);

  const handleCardCtxPlayFrom = useCallback(() => {
    if (!cardCtxMenu || !audioEngine) return;
    let timeMs: number;
    if (cardCtxMenu.wordIndex !== undefined) {
      const syl = lyrics.words[cardCtxMenu.wordIndex].syllables[0];
      timeMs = syl.isSet ? syl.time.msec : 0;
    } else {
      const refs = lyrics.getBeatRefs();
      const ref = refs[cardCtxMenu.beatIndex];
      const syl = lyrics.words[ref.wordIndex].syllables[ref.sylIndex];
      timeMs = syl.isSet ? syl.time.msec : 0;
    }
    handleSeek(timeMs);
    if (!isPlaying) togglePlay();
    setCardCtxMenu(null);
  }, [cardCtxMenu, lyrics, audioEngine, handleSeek, isPlaying, togglePlay]);

  const handleCardCtxSeek = useCallback(() => {
    if (!cardCtxMenu) return;
    let timeMs: number;
    if (cardCtxMenu.wordIndex !== undefined) {
      const syl = lyrics.words[cardCtxMenu.wordIndex].syllables[0];
      timeMs = syl.isSet ? syl.time.msec : 0;
    } else {
      const refs = lyrics.getBeatRefs();
      const ref = refs[cardCtxMenu.beatIndex];
      const syl = lyrics.words[ref.wordIndex].syllables[ref.sylIndex];
      timeMs = syl.isSet ? syl.time.msec : 0;
    }
    handleSeek(timeMs);
    setCardCtxMenu(null);
  }, [cardCtxMenu, lyrics, handleSeek]);

  const handleCardContextMenu = useCallback((e: React.MouseEvent, beatIndex: number, wordIndex?: number) => {
    e.preventDefault();
    e.stopPropagation();
    let isSet = false;
    if (wordIndex !== undefined) {
      const syl = lyrics.words[wordIndex].syllables[0];
      isSet = syl.isSet;
    } else if (beatIndex >= 0) {
      const refs = lyrics.getBeatRefs();
      if (beatIndex < refs.length) {
        const ref = refs[beatIndex];
        isSet = lyrics.words[ref.wordIndex].syllables[ref.sylIndex].isSet;
      }
    }
    setCardCtxMenu({ x: e.clientX, y: e.clientY, beatIndex, wordIndex, isSet });
  }, [lyrics]);

  return (
    <div className="timing-view" onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}>
      {/* Toolbar */}
      <div className="shared-toolbar">
        <input ref={fileInputRef} type="file" accept=".wav,.mp3,.ogg,.flac" style={{ display: 'none' }} onChange={handleImportAudio} />
        <button type="button" className="shared-btn" onClick={() => fileInputRef.current?.click()}>
          <span className="mdi mdi-music" /> {audioFileName || '导入音频'}
        </button>
        <div className="shared-toolbar-sep" />
        <button type="button" className="shared-btn" disabled={!audioEngine} onClick={() => handleSeek(0)}>
          <span className="mdi mdi-skip-previous" />
        </button>
        <button type="button" className="shared-btn" disabled={!audioEngine} onClick={togglePlay}>
          <span className={`mdi ${isPlaying ? 'mdi-stop' : 'mdi-play'}`} />
        </button>
        <button type="button" className="shared-btn" disabled={!audioEngine} onClick={() => handleSeek(audioDuration)}>
          <span className="mdi mdi-skip-next" />
        </button>
        <div className="shared-toolbar-sep" />
        <button type="button" className="shared-btn" disabled={!audioEngine} onClick={() => {
          const step = audioDuration / zoomLevel / 800;
          handleSeek(currentTimeRef.current - step);
        }}>
          <span className="mdi mdi-chevron-double-left" />
        </button>
        <button type="button" className="shared-btn" disabled={!audioEngine} onClick={() => {
          const step = audioDuration / zoomLevel / 800;
          handleSeek(currentTimeRef.current + step);
        }}>
          <span className="mdi mdi-chevron-double-right" />
        </button>
        <div className="shared-toolbar-sep" />
        <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
          <button type="button" className="shared-btn" onClick={() => setCompInputOpen((o) => !o)}>
            <span className="mdi mdi-tune" /> {compensationMs >= 0 ? '+' : ''}{compensationMs}ms
          </button>
          {compInputOpen && (
            <div className="tv-comp-popup">
              <input ref={compInputRef} type="number" value={compensationMs}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (Number.isNaN(v)) { snack?.show('请输入有效数字'); return; }
                  setCompensationMs(v);
                }}
                onKeyDown={handleCompKeyDown}
                style={{ height: '32px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '13px', border: '1px solid var(--hairline)', borderRadius: 'var(--radius-sm)', padding: '0 4px', background: 'var(--canvas)', color: 'var(--ink)', outline: 'none', boxSizing: 'border-box' }}
              />
              <span style={{ fontSize: '11px', color: 'var(--mute)' }}>ms</span>
            </div>
          )}
        </div>
        <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
          <button type="button" className="shared-btn" onClick={() => setSpeedInputOpen((o) => !o)}>
            <span className="mdi mdi-alpha-b-box" /> {speed.toFixed(1)}x
          </button>
          {speedInputOpen && (
            <div className="tv-comp-popup">
              <input ref={speedInputRef} type="number" value={speed}
                step={0.1} min={0.1} max={1.0}
                onChange={(e) => {
                  const raw = parseFloat(e.target.value);
                  if (Number.isNaN(raw)) { snack?.show('请输入有效数字'); return; }
                  const clamped = Math.max(0.1, Math.min(1.0, Math.round(raw * 10) / 10));
                  setSpeed(clamped);
                  audioEngine?.setPlaybackRate(clamped);
                }}
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') setSpeedInputOpen(false); }}
                style={{ height: '32px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '13px', border: '1px solid var(--hairline)', borderRadius: 'var(--radius-sm)', padding: '0 4px', background: 'var(--canvas)', color: 'var(--ink)', outline: 'none', boxSizing: 'border-box' }}
              />
              <span style={{ fontSize: '11px', color: 'var(--mute)' }}>x</span>
            </div>
          )}
        </div>
        <div className="shared-toolbar-sep" />
        <button type="button" className="shared-btn" onClick={() => setMultiLine((m) => !m)}>
          <span className={`mdi ${multiLine ? 'mdi-format-columns' : 'mdi-view-list'}`} /> {multiLine ? '多行视图' : '单行视图'}
        </button>
        <span style={{ fontSize: '12px', color: 'var(--mute)', marginLeft: 'auto' }}>
          {audioDuration > 0 ? `${fmtSec(Math.round(audioDuration / 1000))}` : '5:00'}
          {' · '}{(audioDuration / zoomLevel / 1000).toFixed(1)}s
        </span>
      </div>

      {/* Lyrics row */}
      <div className="tv-lyrics" ref={lyricsRef} style={{ flex: multiLine ? '2' : '1', justifyContent: multiLine ? 'flex-start' : 'center' }}>
        {multiLine ? (
          <MultiLineView
            viewData={viewData}
            onSelectBeat={handleClickBeat}
            editingBeatIndex={editingBeatIndex}
            editingTimeValue={editingTimeValue}
            onEditingTimeChange={setEditingTimeValue}
            onFinishEditTime={handleFinishEditTime}
            onDoubleClickTime={handleDoubleClickTime}
            editTimeRef={editTimeRef}
            editingWordIndex={editingWordIndex}
            onCardContextMenu={handleCardContextMenu}
          />
        ) : (
          <div className="tv-columns-row" ref={columnsRowRef}>
            {viewData.map((wordInfo, wi) => {
              const editingHere = editingBeatIndex !== null && (
                wordInfo.syllables.some(s => s.beatIndex >= 0 && s.beatIndex === editingBeatIndex) ||
                (editingBeatIndex === -1 && editingWordIndex === wi && wordInfo.syllables.some(s => s.beatIndex === -1))
              );
              return (
              <div className="tv-column" key={wi} data-word-index={wi}>
                <span onClick={() => {
                  const fs = wordInfo.syllables[0];
                  if (fs && fs.beatIndex >= 0) handleClickBeat(fs.beatIndex);
                }} onDoubleClick={() => {
                  const fs = wordInfo.syllables[0];
                  if (fs && fs.beatIndex >= 0) handleDoubleClickTime(fs.beatIndex);
                  else if (fs && (wordInfo.isSpace || wordInfo.isNewline)) handleDoubleClickTime(-1, wi);
                }} onContextMenu={(e) => {
                  const fs = wordInfo.syllables[0];
                  if (fs && fs.beatIndex >= 0) handleCardContextMenu(e, fs.beatIndex);
                  else if (fs && (wordInfo.isSpace || wordInfo.isNewline)) handleCardContextMenu(e, -1, wi);
                }}>
                  {editingHere ? (
                    <input ref={editTimeRef}
                      className="wc-edit-input"
                      value={editingTimeValue}
                      onChange={(e) => setEditingTimeValue(e.target.value)}
                      onBlur={handleEditTimeBlur}
                      onKeyDown={handleEditTimeKeyDown}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <TimingWordCard wordInfo={wordInfo} />
                  )}
                </span>
                <div className="tv-col-slot">
                  {wordInfo.isSpace || wordInfo.isNewline ? (
                    <span className={`tv-dot-cell ${wordInfo.syllables[0]?.isSet ? 'tv-dot-set' : 'tv-dot-unset'}`}
                      onDoubleClick={() => handleDoubleClickTime(-1, wi)} />
                  ) : (
                    <TriangleGroup wordInfo={wordInfo} onSelectBeat={handleClickBeat} />
                  )}
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Ruler */}
      <div className="tv-ruler-wrap">
        <TimeRuler
          duration={audioDuration}
          zoomLevel={zoomLevel}
          scrollOffset={scrollOffset}
          onSeek={handleSeek}
        />
      </div>

      {/* Waveform */}
      <div className="tv-waveform-wrap" style={{ flex: '1' }} onWheel={handleWheel}>
        <Waveform key={multiLine ? 'multi' : 'single'}
          engine={audioEngine}
          duration={audioDuration}
          currentTime={currentTime}
          zoomLevel={zoomLevel}
          scrollOffset={scrollOffset}
          onSeek={handleSeek}
          timeRef={currentTimeRef}
          beatTimesMs={beatTimesMs}
          selectedBeatTimeMs={selectedBeatTimeMs}
          verticalZoom={verticalZoom}
          verticalOffset={verticalOffset}
        />
      </div>

      {ctxMenu && (
        <div ref={ctxMenuRef} className="shared-ctx-menu" style={{ position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, zIndex: 1000 }}>
          <button className="shared-ctx-item" onClick={() => handleCtxAction(() => { undoManager.undo(lyrics); onRequestRender?.(); })} disabled={!undoManager.canUndo()}>撤销</button>
          <button className="shared-ctx-item" onClick={() => handleCtxAction(() => { undoManager.redo(lyrics); onRequestRender?.(); })} disabled={!undoManager.canRedo()}>重做</button>
          <div className="shared-ctx-sep" />
          <button className="shared-ctx-item" onClick={() => handleCtxAction(togglePlay)} disabled={!audioEngine}>{isPlaying ? '暂停' : '播放'}</button>
          <button className="shared-ctx-item" onClick={() => handleCtxAction(() => handleSeek(0))} disabled={!audioEngine}>到开始</button>
          <button className="shared-ctx-item" onClick={() => handleCtxAction(() => handleSeek(audioDuration))} disabled={!audioEngine}>到结尾</button>
          <div className="shared-ctx-sep" />
          <button className="shared-ctx-item" onClick={() => handleCtxAction(() => updateState(moveToNextBeat(state, lyrics)))}>前进一格</button>
          <button className="shared-ctx-item" onClick={() => handleCtxAction(() => updateState(moveToPrevBeat(state)))}>后退一格</button>
        </div>
      )}
      {cardCtxMenu && (
        <div ref={cardCtxRef} className="shared-ctx-menu" style={{ position: 'fixed', left: cardCtxMenu.x, top: cardCtxMenu.y, zIndex: 1000 }}>
          <button className="shared-ctx-item" onClick={() => handleCardCtxAction(handleCardCtxReset)} disabled={!cardCtxMenu.isSet}>重置时间</button>
          <div className="shared-ctx-sep" />
          <button className="shared-ctx-item" onClick={() => handleCardCtxAction(() => handleCardCtxShift(-10))} disabled={!cardCtxMenu.isSet}>前移10ms</button>
          <button className="shared-ctx-item" onClick={() => handleCardCtxAction(() => handleCardCtxShift(10))} disabled={!cardCtxMenu.isSet}>后移10ms</button>
          <div className="shared-ctx-sep" />
          <button className="shared-ctx-item" onClick={() => handleCardCtxAction(handleCardCtxPlayFrom)} disabled={!audioEngine || !cardCtxMenu.isSet}>从该音节开始播放</button>
          <button className="shared-ctx-item" onClick={() => handleCardCtxAction(handleCardCtxSeek)} disabled={!audioEngine || !cardCtxMenu.isSet}>转到该音节的位置</button>
        </div>
      )}
      {/* Bottom bar */}
      <div className="tv-bottom">
        {audioDuration > 0 && (
          <span className="tv-time">
            {fmtSec(Math.round(currentTime / 1000))}
            {' / '}
            {fmtSec(Math.round(audioDuration / 1000))}
          </span>
        )}
        {state.selectedBeatIndex >= 0 && (
          <span className="tv-beat-info">
            Beat {state.selectedBeatIndex + 1}/{lyrics.getBeatRefs().length}
            {selectedBeatTimeMs !== null && ` · ${fmtSec(Math.round(selectedBeatTimeMs / 1000))}`}
          </span>
        )}
      </div>
    </div>
  );
}


