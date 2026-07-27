import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { Lyrics } from '../../editor/lyrics';
import type { TimingState } from '../../timing/types';
import { buildTimingView } from '../../timing/view';
import {
  moveToNextBeat,
  moveToPrevBeat,
  moveToBeat,
  setBeatTime,
  clearBeatTime,
  postSetBeat,
} from '../../timing/operations';
import inferSeparatorTimes from '../../timing/separator';
import { getBpmAtTime, snapToBpmGrid } from '../../timing';
import { setSyllableTime, unsetSyllableTime } from '../../editor/syllable';
import { parseTime, formatTime } from '../../editor/time';
import { UndoManager } from '../../shared/undo-manager';
import AudioEngine from './AudioEngine';
import Waveform from './Waveform';
import TimeRuler from './TimeRuler';
import { TimingWordCard, TriangleGroup, MultiLineView } from './LyricsView';
import TimingToolbar from './TimingToolbar';
import TimingCanvasCtxMenu from './TimingCanvasCtxMenu';
import TimingCardCtxMenu from './TimingCardCtxMenu';
import TimingFineTuneView from './TimingFineTuneView';
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
  onAudioChange: (
    engine: AudioEngine | null,
    duration: number,
    fileName: string,
  ) => void;
}

export default function TimingView({
  lyrics,
  state,
  onStateChange,
  undoManager,
  renderVersion,
  onRequestRender,
  snack,
  audioEngine,
  audioDuration,
  audioFileName,
  onAudioChange,
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
  const [timelineView, setTimelineView] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragCurrentTimeMs, setDragCurrentTimeMs] = useState<number | null>(
    null,
  );
  const dragRef = useRef<{
    startX: number;
    startTimeMs: number;
    wordIndex: number;
    sylIndex: number;
    offsetMs: number;
  } | null>(null);
  const [speed, setSpeed] = useState(1.0);
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
  const editTimeRef = useRef<HTMLInputElement>(null);
  const isMultiLineRef = useRef(false);
  isMultiLineRef.current = multiLine;
  const fmtSec = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const animRef = useRef<number>(0);
  const lyricsRef = useRef<HTMLDivElement>(null);
  const columnsRowRef = useRef<HTMLDivElement>(null);

  const updateState = useCallback(
    (next: TimingState) => {
      onStateChange?.(next);
    },
    [onStateChange],
  );

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

  // Auto-load audio from saved file path
  useEffect(() => {
    if (audioEngine || !state.audioFilePath || !window.electron?.fs) return;
    (async () => {
      try {
        const dataUrl = await window.electron.fs.readFileDataUrl(
          state.audioFilePath,
        );
        const engine = new AudioEngine();
        await engine.loadFromDataUrl(dataUrl, state.audioFilePath);
        engine.setPlaybackRate(speed);
        onAudioChange(
          engine,
          engine.duration,
          state.audioFilePath.split(/[/\\]/).pop() ?? state.audioFilePath,
        );
        setCurrentTime(0);
        currentTimeRef.current = 0;
      } catch {
        // silent — file may have moved
      }
    })();
  }, [state.audioFilePath]); // re-run when audio path changes

  // Sync scroll offset when zoom changes
  useEffect(() => {
    const maxScroll = Math.max(0, audioDuration - audioDuration / zoomLevel);
    setScrollOffset((s) => Math.min(s, maxScroll));
  }, [zoomLevel, audioDuration]);

  // BPM segments for waveform grid + start lines
  const bpmSegments = state.fineTune.bpmSegments;

  // Beat data for waveform labels + beat time line (only in timeline view)
  const beatData = useMemo(() => {
    const items: {
      timeMs: number;
      endMs: number;
      reading: string;
      timeStr: string;
      wordIndex: number;
      sylIndex: number;
    }[] = [];
    const setTimes: {
      timeMs: number;
      reading: string;
      wordIndex: number;
      sylIndex: number;
    }[] = [];

    lyrics.getAllBeatRefs().forEach((ref) => {
      const syl = lyrics.words[ref.wordIndex].syllables[ref.sylIndex];
      if (!syl.isSet) return;
      if (ref.isSeparator) {
        const reading = syl.reading === '\n' ? '\u00b6' : '\u2423';
        setTimes.push({
          timeMs: syl.time.msec,
          reading,
          wordIndex: ref.wordIndex,
          sylIndex: ref.sylIndex,
        });
      } else {
        const r = syl.reading.trim();
        const reading = r === '' ? '\u2423' : r === '\n' ? '\u00b6' : r;
        setTimes.push({
          timeMs: syl.time.msec,
          reading,
          wordIndex: ref.wordIndex,
          sylIndex: ref.sylIndex,
        });
      }
    });
    setTimes.sort((a, b) => a.timeMs - b.timeMs);

    setTimes.forEach((st, i) => {
      const endMs =
        i < setTimes.length - 1 ? setTimes[i + 1].timeMs : audioDuration;
      const timeStr = formatTime(
        { msec: Math.round(st.timeMs) },
        '.',
        false,
        false,
      );
      items.push({
        timeMs: st.timeMs,
        endMs,
        reading: st.reading,
        timeStr,
        wordIndex: st.wordIndex,
        sylIndex: st.sylIndex,
      });
    });

    return items;
  }, [lyrics, renderVersion, audioDuration]);

  // Adjust zoom & ensure default BPM when switching to fine tune mode
  useEffect(() => {
    if (timelineView && state.fineTune.bpmSegments.length === 0) {
      updateState({
        ...state,
        fineTune: { ...state.fineTune, bpmSegments: [{ bpm: 120, start: 0 }] },
      });
    }
  }, [timelineView]);

  // Adjust fine-tune zoom when audio loads/changes
  useEffect(() => {
    if (timelineView && audioDuration > 0) {
      setZoomLevel((z) => {
        const minZ = Math.max(1, audioDuration / 10000);
        return Math.max(minZ, z);
      });
    }
  }, [timelineView, audioDuration]);

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

  const viewData = useMemo(
    () => buildTimingView(lyrics, { ...state, currentPlayheadMs: currentTime }),
    [lyrics, state, currentTime, renderVersion],
  );

  // ── Audio handlers ──

  const handleImportAudio = useCallback(async () => {
    if (!window.electron?.project?.openAudio) {
      snack?.show('导入音频失败：请使用 Electron 环境运行');
      return;
    }
    try {
      const result = await window.electron.project.openAudio();
      if (!result) return;
      const { filePath, dataUrl } = result;
      const engine = new AudioEngine();
      await engine.loadFromDataUrl(dataUrl, filePath);
      engine.setPlaybackRate(speed);
      onAudioChange(
        engine,
        engine.duration,
        filePath.split(/[/\\]/).pop() ?? filePath,
      );
      setCurrentTime(0);
      currentTimeRef.current = 0;
      updateState({
        ...state,
        audioFilePath: filePath,
        audioMeta: { duration: engine.duration, fileSize: 0 },
      });
    } catch (err) {
      snack?.show('音频加载失败');
      console.error(err);
    }
  }, [onAudioChange, snack, speed, state, updateState]);

  const handleSeek = useCallback(
    (timeMs: number) => {
      const clamped = Math.max(0, Math.min(timeMs, audioDuration));
      currentTimeRef.current = clamped;
      setCurrentTime(clamped);
      audioEngine?.seek(clamped);
    },
    [audioDuration, audioEngine],
  );

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
      const syl =
        lyrics.words[refs[idx].wordIndex].syllables[refs[idx].sylIndex];
      if (syl.isSet) {
        updateState(moveToNextBeat(state, lyrics));
        return;
      }
    }
    setBeatTime(lyrics, state, Math.round(currentTime + compensationMs));
    const ns = postSetBeat(lyrics, state, idx);
    updateState(moveToNextBeat(ns, lyrics));
    undoManager.record(lyrics);
    onRequestRender?.();
  }, [
    lyrics,
    state,
    updateState,
    undoManager,
    currentTime,
    compensationMs,
    audioEngine,
    onRequestRender,
  ]);

  const handleClearBeat = useCallback(() => {
    const refs = lyrics.getBeatRefs();
    const idx = state.selectedBeatIndex;
    // If already unset, just go back without doing anything
    if (idx >= 0 && idx < refs.length) {
      const syl =
        lyrics.words[refs[idx].wordIndex].syllables[refs[idx].sylIndex];
      if (!syl.isSet) {
        updateState(moveToPrevBeat(state));
        return;
      }
    }
    clearBeatTime(lyrics, state);
    let ns = moveToPrevBeat(state);
    ns = postSetBeat(lyrics, ns, idx);
    updateState(ns);
    undoManager.record(lyrics);
    onRequestRender?.();
  }, [lyrics, state, updateState, undoManager, onRequestRender]);

  // Scan all separator times (called on mount / view switch)
  const scanAllSeparators = useCallback((lyr: Lyrics) => {
    const beatRefs = lyr.getBeatRefs();
    beatRefs.forEach((ref, i) => {
      const syl = lyr.words[ref.wordIndex].syllables[ref.sylIndex];
      if (syl.isSet) {
        inferSeparatorTimes(lyr, i, true);
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
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
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
  }, [
    handleSetBeat,
    handleClearBeat,
    togglePlay,
    state,
    lyrics,
    updateState,
    setVerticalZoom,
    setVerticalOffset,
  ]);

  // ── Beat navigation ──

  const handleClickBeat = useCallback(
    (beatIndex: number) => {
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
          if (
            beatMs < scrollOffset ||
            beatMs > scrollOffset + visibleMs - margin
          ) {
            setScrollOffset(Math.max(0, beatMs - visibleMs * 0.3));
          }
        }
      }
    },
    [
      state,
      lyrics,
      updateState,
      audioDuration,
      zoomLevel,
      scrollOffset,
      isPlaying,
    ],
  );

  const handleClickWord = useCallback(
    (wordIndex: number) => {
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
    },
    [lyrics, handleClickBeat],
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        // Logarithmic zoom: factor per scroll tick
        const factor = e.deltaY > 0 ? 0.92 : 1.08;
        setZoomLevel((z) => {
          const isFine = timelineView;
          const minZ = isFine ? Math.max(1, audioDuration / 10000) : 1;
          const maxZ = isFine
            ? Math.max(1, audioDuration / 1000)
            : Math.max(1, audioDuration / 2000);
          return Math.max(minZ, Math.min(maxZ, z * factor));
        });
      } else {
        const visibleMs = Math.max(1, audioDuration / zoomLevel);
        const maxScroll = Math.max(0, audioDuration - visibleMs);
        setScrollOffset((s) => {
          const dir = e.deltaY > 0 ? 1 : -1;
          return Math.max(0, Math.min(maxScroll, s + (dir * visibleMs) / 5));
        });
      }
    },
    [audioDuration, zoomLevel, timelineView],
  );

  // ── Beat time card drag ──

  const handleBeatDragStart = useCallback(
    (e: React.MouseEvent, i: number, bd: (typeof beatData)[number]) => {
      e.preventDefault();
      const el = document.querySelector('.tv-beattime-line');
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const visibleMs = audioDuration / zoomLevel;
      const fromMs = scrollOffset;
      // Mouse X as time, minus card's left-edge time → offset in ms
      const mouseTime =
        fromMs + ((e.clientX - rect.left) / rect.width) * visibleMs;
      const offsetMs = mouseTime - bd.timeMs;
      setDragIdx(i);
      dragRef.current = {
        startX: e.clientX,
        startTimeMs: bd.timeMs,
        wordIndex: bd.wordIndex,
        sylIndex: bd.sylIndex,
        offsetMs,
      };
    },
    [audioDuration, zoomLevel, scrollOffset],
  );

  useEffect(() => {
    if (dragIdx === null) return;
    const el = document.querySelector('.tv-beattime-line');
    if (!el) return;

    const computeTime = (clientX: number) => {
      const rect = el.getBoundingClientRect();
      const visibleMs = audioDuration / zoomLevel;
      const fromMs = scrollOffset;
      const ratio = (clientX - rect.left) / rect.width;
      return Math.max(
        0,
        Math.min(
          audioDuration,
          fromMs + ratio * visibleMs - (dragRef.current?.offsetMs ?? 0),
        ),
      );
    };

    const handleMove = (e: MouseEvent) => {
      setDragCurrentTimeMs(computeTime(e.clientX));
    };

    const handleUp = (e: MouseEvent) => {
      if (!dragRef.current) return;
      let newTimeMs = computeTime(e.clientX);

      if (snapToGrid) {
        const bpm = getBpmAtTime(state.fineTune.bpmSegments, newTimeMs);
        if (bpm !== null) {
          newTimeMs = snapToBpmGrid(newTimeMs, state.fineTune.bpmSegments, 4);
        }
      }

      const { wordIndex, sylIndex } = dragRef.current;
      const syl = lyrics.words[wordIndex].syllables[sylIndex];
      setSyllableTime(syl, { msec: Math.round(newTimeMs) });
      updateState({ ...state });
      undoManager.record(lyrics);
      onRequestRender?.();
      setDragIdx(null);
      setDragCurrentTimeMs(null);
      dragRef.current = null;
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      setDragCurrentTimeMs(null);
    };
  }, [
    dragIdx,
    audioDuration,
    zoomLevel,
    scrollOffset,
    snapToGrid,
    lyrics,
    state,
    updateState,
    onRequestRender,
    undoManager,
  ]);

  // Auto-scroll lyrics to keep selected beat visible
  // Only scrolls when the element is fully out of view, and positions
  // it at ~1/3 from the start (leaving context before + room ahead).
  useEffect(() => {
    if (state.selectedBeatIndex < 0) return;

    // Multi-line: try data-beat-index first
    const multiEl = lyricsRef.current?.querySelector(
      `[data-beat-index="${state.selectedBeatIndex}"]`,
    );
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
    const wordIdx = viewData.findIndex((wi) =>
      wi.syllables.some((s) => s.beatIndex === state.selectedBeatIndex),
    );
    if (wordIdx < 0) return;
    const singleEl = lyricsRef.current?.querySelector(
      `[data-word-index="${wordIdx}"]`,
    );
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

  const handleDoubleClickTime = useCallback(
    (beatIndex: number, optWordIndex?: number) => {
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
    },
    [lyrics],
  );

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
      setSyllableTime(word.syllables[0], parsed);
      // Update state to clear any pending beats related to this separator
      updateState({ ...state });
      undoManager.record(lyrics);
    } else if (editingBeatIndex >= 0) {
      if (isMultiLineRef.current) {
        // Multi-line view: edit only the specific syllable
        const stateWithBeat = { ...state, selectedBeatIndex: editingBeatIndex };
        setBeatTime(lyrics, stateWithBeat, parsed.msec);
        const ns = postSetBeat(lyrics, stateWithBeat, editingBeatIndex);
        if (ns !== stateWithBeat) updateState(ns);
        undoManager.record(lyrics);
      } else {
        // Single-line view: shift all syllables of the word by offset
        const refs = lyrics.getBeatRefs();
        if (editingBeatIndex < 0 || editingBeatIndex >= refs.length) return;
        const ref = refs[editingBeatIndex];
        const word = lyrics.words[ref.wordIndex];

        const firstSyl = word.syllables[0];
        if (firstSyl.isSet) {
          const offset = parsed.msec - firstSyl.time.msec;
          word.syllables.forEach((syl) => {
            if (syl.isSet) {
              setSyllableTime(syl, {
                msec: Math.max(0, syl.time.msec + offset),
              });
            }
          });
        } else {
          // First syllable was unset, set it directly
          setSyllableTime(firstSyl, parsed);
        }

        // Trigger separator inference from this beat
        const ns = postSetBeat(lyrics, state, editingBeatIndex);
        if (ns !== state) updateState(ns);
        undoManager.record(lyrics);
      }
      onRequestRender?.();
    }
    setEditingBeatIndex(null);
    setEditingWordIndex(null);
  }, [
    editingBeatIndex,
    editingWordIndex,
    editingTimeValue,
    lyrics,
    state,
    undoManager,
    snack,
    updateState,
    onRequestRender,
  ]);

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

  // ── Card context menu ──

  const handleCardCtxReset = useCallback(() => {
    if (!cardCtxMenu) return;
    if (cardCtxMenu.wordIndex !== undefined) {
      const word = lyrics.words[cardCtxMenu.wordIndex];
      word.syllables.forEach((syl) => unsetSyllableTime(syl));
    } else if (isMultiLineRef.current) {
      // Multi-line view: reset only this syllable
      clearBeatTime(lyrics, {
        ...state,
        selectedBeatIndex: cardCtxMenu.beatIndex,
      });
    } else {
      // Single-line view: reset all syllables of the word
      const refs = lyrics.getBeatRefs();
      const ref = refs[cardCtxMenu.beatIndex];
      const word = lyrics.words[ref.wordIndex];
      word.syllables.forEach((syl) => unsetSyllableTime(syl));
    }
    undoManager.record(lyrics);
    setCardCtxMenu(null);
    onRequestRender?.();
  }, [cardCtxMenu, lyrics, state, undoManager, onRequestRender]);

  const handleCardCtxShift = useCallback(
    (delta: number) => {
      if (!cardCtxMenu) return;
      if (cardCtxMenu.wordIndex !== undefined) {
        const word = lyrics.words[cardCtxMenu.wordIndex];
        word.syllables.forEach((syl) => {
          if (syl.isSet) {
            setSyllableTime(syl, { msec: Math.max(0, syl.time.msec + delta) });
          }
        });
      } else if (isMultiLineRef.current) {
        // Multi-line view: shift only this syllable
        const refs = lyrics.getBeatRefs();
        const ref = refs[cardCtxMenu.beatIndex];
        const syl = lyrics.words[ref.wordIndex].syllables[ref.sylIndex];
        const current = syl.isSet ? syl.time.msec : 0;
        setSyllableTime(syl, { msec: Math.max(0, current + delta) });
      } else {
        // Single-line view: shift all set syllables of the word
        const refs = lyrics.getBeatRefs();
        const ref = refs[cardCtxMenu.beatIndex];
        const word = lyrics.words[ref.wordIndex];
        word.syllables.forEach((syl) => {
          if (syl.isSet) {
            setSyllableTime(syl, { msec: Math.max(0, syl.time.msec + delta) });
          }
        });
      }
      undoManager.record(lyrics);
      setCardCtxMenu(null);
      onRequestRender?.();
    },
    [cardCtxMenu, lyrics, undoManager, onRequestRender],
  );

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

  const handleCardContextMenu = useCallback(
    (e: React.MouseEvent, beatIndex: number, wordIndex?: number) => {
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
      setCardCtxMenu({
        x: e.clientX,
        y: e.clientY,
        beatIndex,
        wordIndex,
        isSet,
      });
    },
    [lyrics],
  );

  return (
    <div
      className="timing-view"
      onContextMenu={(e) => {
        e.preventDefault();
        setCtxMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <TimingToolbar
        audioEngine={audioEngine}
        audioDuration={audioDuration}
        audioFileName={audioFileName}
        isPlaying={isPlaying}
        zoomLevel={zoomLevel}
        currentTimeRef={currentTimeRef}
        compensationMs={compensationMs}
        speed={speed}
        multiLine={multiLine}
        timelineView={timelineView}
        snapToGrid={snapToGrid}
        snack={snack}
        onToggleSnap={() => setSnapToGrid((v) => !v)}
        onTogglePlay={togglePlay}
        onSeek={handleSeek}
        onChangeCompensation={setCompensationMs}
        onChangeSpeed={(s) => {
          setSpeed(s);
          audioEngine?.setPlaybackRate(s);
        }}
        onToggleMultiLine={() => setMultiLine((m) => !m)}
        onToggleTimelineView={() => {
          setTimelineView((v) => !v);
        }}
        onImportAudio={handleImportAudio}
      />

      {/* Lyrics row */}
      <div
        className={`tv-lyrics ${timelineView ? 'tv-lyrics-finetune' : ''}`}
        ref={lyricsRef}
        style={{
          flex: timelineView ? '0 0 24px' : multiLine ? '2' : '1',
          justifyContent: multiLine ? 'flex-start' : 'center',
        }}
      >
        {timelineView ? (
          <TimingFineTuneView
            bpmSegments={state.fineTune.bpmSegments}
            zoomLevel={zoomLevel}
            scrollOffset={scrollOffset}
            duration={audioDuration}
            snack={snack}
            onUpdateBpm={(i, bpm) => {
              const segs = [...state.fineTune.bpmSegments].sort(
                (a, b) => a.start - b.start,
              );
              if (segs[i]) segs[i] = { ...segs[i], bpm };
              updateState({
                ...state,
                fineTune: { ...state.fineTune, bpmSegments: segs },
              });
              undoManager.record(lyrics);
            }}
            onUpdateStartTime={(i, start) => {
              const segs = [...state.fineTune.bpmSegments]
                .map((s, idx) => (idx === i ? { ...s, start } : s))
                .sort((a, b) => a.start - b.start);
              updateState({
                ...state,
                fineTune: { ...state.fineTune, bpmSegments: segs },
              });
              undoManager.record(lyrics);
            }}
            onDeleteSegment={(i) => {
              const segs = [...state.fineTune.bpmSegments]
                .filter((_, idx) => idx !== i)
                .sort((a, b) => a.start - b.start);
              updateState({
                ...state,
                fineTune: { ...state.fineTune, bpmSegments: segs },
              });
              undoManager.record(lyrics);
            }}
            onAddSegment={(start, bpm) => {
              const segs = [...state.fineTune.bpmSegments, { start, bpm }].sort(
                (a, b) => a.start - b.start,
              );
              updateState({
                ...state,
                fineTune: { ...state.fineTune, bpmSegments: segs },
              });
              undoManager.record(lyrics);
            }}
            onSeek={handleSeek}
            audioLoaded={!!audioEngine}
          />
        ) : multiLine ? (
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
              const editingHere =
                editingBeatIndex !== null &&
                (wordInfo.syllables.some(
                  (s) => s.beatIndex >= 0 && s.beatIndex === editingBeatIndex,
                ) ||
                  (editingBeatIndex === -1 &&
                    editingWordIndex === wi &&
                    wordInfo.syllables.some((s) => s.beatIndex === -1)));
              return (
                <div className="tv-column" key={wi} data-word-index={wi}>
                  <span
                    onClick={() => {
                      const fs = wordInfo.syllables[0];
                      if (fs && fs.beatIndex >= 0)
                        handleClickBeat(fs.beatIndex);
                    }}
                    onDoubleClick={() => {
                      const fs = wordInfo.syllables[0];
                      if (fs && fs.beatIndex >= 0)
                        handleDoubleClickTime(fs.beatIndex);
                      else if (fs && (wordInfo.isSpace || wordInfo.isNewline))
                        handleDoubleClickTime(-1, wi);
                    }}
                    onContextMenu={(e) => {
                      const fs = wordInfo.syllables[0];
                      if (fs && fs.beatIndex >= 0)
                        handleCardContextMenu(e, fs.beatIndex);
                      else if (fs && (wordInfo.isSpace || wordInfo.isNewline))
                        handleCardContextMenu(e, -1, wi);
                    }}
                  >
                    {editingHere ? (
                      <input
                        ref={editTimeRef}
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
                      <span
                        className={`tv-dot-cell ${wordInfo.syllables[0]?.isSet ? 'tv-dot-set' : 'tv-dot-unset'}`}
                        onDoubleClick={() => handleDoubleClickTime(-1, wi)}
                      />
                    ) : (
                      <TriangleGroup
                        wordInfo={wordInfo}
                        onSelectBeat={handleClickBeat}
                      />
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

      {/* Beat time line (only in timeline view) */}
      {timelineView && (
        <div className="tv-beattime-line">
          {beatData.map((bd, i) => {
            const visibleMs = audioDuration / zoomLevel;
            const fromMs = scrollOffset;
            const x = ((bd.timeMs - fromMs) / visibleMs) * 100;
            const isVisible =
              bd.timeMs >= fromMs && bd.timeMs <= fromMs + visibleMs;
            const isDragging = dragIdx === i;
            const displayTime =
              isDragging && dragCurrentTimeMs !== null
                ? dragCurrentTimeMs
                : bd.timeMs;
            const displayX = ((displayTime - fromMs) / visibleMs) * 100;
            return (
              <div
                key={i}
                className={`tv-bpm-card${isDragging ? ' tv-bpm-card-dragging' : ''}`}
                style={{
                  position: 'absolute',
                  left: `${displayX}%`,
                  display: isVisible || isDragging ? 'flex' : 'none',
                  cursor: 'ew-resize',
                  userSelect: 'none',
                }}
                onMouseDown={(e) => handleBeatDragStart(e, i, bd)}
              >
                {isDragging && dragCurrentTimeMs !== null
                  ? formatTime(
                      { msec: Math.round(dragCurrentTimeMs) },
                      '.',
                      false,
                      false,
                    )
                  : bd.timeStr}
              </div>
            );
          })}
        </div>
      )}

      {/* Waveform */}
      <div
        className="tv-waveform-wrap"
        style={{ flex: '1' }}
        onWheel={handleWheel}
      >
        <Waveform
          key={timelineView ? 'finetune' : multiLine ? 'multi' : 'single'}
          engine={audioEngine}
          duration={audioDuration}
          currentTime={currentTime}
          zoomLevel={zoomLevel}
          scrollOffset={scrollOffset}
          onSeek={handleSeek}
          timeRef={currentTimeRef}
          beatTimesMs={timelineView ? undefined : beatTimesMs}
          selectedBeatTimeMs={timelineView ? undefined : selectedBeatTimeMs}
          bpmSegments={timelineView ? bpmSegments : undefined}
          beatLabels={
            timelineView
              ? beatData.map((d) => ({
                  timeMs: d.timeMs,
                  endMs: d.endMs,
                  label: d.reading,
                }))
              : undefined
          }
          dragTimeMs={timelineView ? dragCurrentTimeMs : undefined}
          verticalZoom={verticalZoom}
          verticalOffset={verticalOffset}
        />
      </div>

      {ctxMenu && (
        <TimingCanvasCtxMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          canUndo={undoManager.canUndo()}
          canRedo={undoManager.canRedo()}
          audioEngine={!!audioEngine}
          isPlaying={isPlaying}
          onClose={() => setCtxMenu(null)}
          onUndo={() => {
            undoManager.undo(lyrics);
            onRequestRender?.();
          }}
          onRedo={() => {
            undoManager.redo(lyrics);
            onRequestRender?.();
          }}
          onTogglePlay={togglePlay}
          onSeekStart={() => handleSeek(0)}
          onSeekEnd={() => handleSeek(audioDuration)}
          onNextBeat={() => updateState(moveToNextBeat(state, lyrics))}
          onPrevBeat={() => updateState(moveToPrevBeat(state))}
        />
      )}
      {cardCtxMenu && (
        <TimingCardCtxMenu
          x={cardCtxMenu.x}
          y={cardCtxMenu.y}
          isSet={cardCtxMenu.isSet}
          audioEngine={!!audioEngine}
          onClose={() => setCardCtxMenu(null)}
          onReset={handleCardCtxReset}
          onShift={handleCardCtxShift}
          onPlayFrom={handleCardCtxPlayFrom}
          onSeek={handleCardCtxSeek}
        />
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
            {selectedBeatTimeMs !== null &&
              ` · ${fmtSec(Math.round(selectedBeatTimeMs / 1000))}`}
          </span>
        )}
      </div>
    </div>
  );
}
