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
import { isSeparatorWord } from '../../editor/word';
import { getBpmAtTime, snapToBpmGrid } from '../../timing';
import {
  detectRhythm,
  segmentBpmChanges,
  separateVocals,
  alignVocals,
  checkAutoTiming,
  readAudioBuffer,
  getWavInfo,
  type SeparateResult,
} from '../../timing/audio-analysis';
import { alignSegmentsToLyrics } from '../../timing/whisper/align';
import AutoTimingDialog from './AutoTimingDialog';
import type { AutoTimingOptions } from './AutoTimingDialog';
import { setSyllableTime, unsetSyllableTime } from '../../editor/syllable';
import { parseTime, formatTime, createTime } from '../../editor/time';
import useTimingKeyboard from './hooks/useTimingKeyboard';
import { useTimingRuntime } from '../../renderer/store/timingRuntime';
import AudioEngine from './AudioEngine';
import Waveform from './Waveform';
import TimeRuler from './TimeRuler';
import { TimingWordCard, TriangleGroup, MultiLineView } from './LyricsView';
import TimingToolbar from './TimingToolbar';
import TimingCanvasCtxMenu from './TimingCanvasCtxMenu';
import TimingCardCtxMenu from './TimingCardCtxMenu';
import TimingFineTuneView from './TimingFineTuneView';
import './timing.css';

/** Derive the cached vocals path next to the source audio (`源名-vocal.wav`). */
function vocalCachePath(audioPath: string): string {
  const p = audioPath.replace(/\\/g, '/');
  const lastSlash = p.lastIndexOf('/');
  const dir = lastSlash >= 0 ? p.slice(0, lastSlash) : '';
  const file = lastSlash >= 0 ? p.slice(lastSlash + 1) : p;
  const dot = file.lastIndexOf('.');
  const base = dot > 0 ? file.slice(0, dot) : file;
  return dir ? `${dir}/${base}-vocal.wav` : `${base}-vocal.wav`;
}

/**
 * Snap every timed syllable to the nearest 32nd-note grid of the stored BPM
 * segments (32nd = one eighth of a quarter-note beat). Only touches already
 * timed syllables; separators are left as-is.
 */
function snapToBeatGrid(
  lyrics: Lyrics,
  bpmSegments: { bpm: number; start: number }[],
): void {
  if (!bpmSegments || bpmSegments.length === 0) return;
  const findBpm = (t: number): { bpm: number; start: number } => {
    let seg = bpmSegments[0];
    for (const s of bpmSegments) {
      if (s.start <= t) seg = s;
      else break;
    }
    return seg;
  };
  lyrics.words.forEach((word) => {
    if (isSeparatorWord(word)) return;
    word.syllables.forEach((syl, si) => {
      if (!syl.isSet) return;
      const t = syl.time.msec;
      const seg = findBpm(t);
      const gridMs = 60000 / seg.bpm / 8;
      const snapped = seg.start + Math.round((t - seg.start) / gridMs) * gridMs;
      word.syllables[si] = setSyllableTime(
        word.syllables[si],
        createTime(Math.max(0, Math.round(snapped))),
      );
    });
  });
}

interface TimingViewProps {
  lyrics: Lyrics;
  state: TimingState;
  onStateChange?: (state: TimingState) => void;
  onUndoRecord?: () => void;
  onUndo?: () => boolean;
  onRedo?: () => boolean;
  canUndo?: () => boolean;
  canRedo?: () => boolean;
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
  detectingBpm?: boolean;
  onDetectingBpmChange?: (v: boolean) => void;
  autoTimingBusy?: boolean;
  onAutoTimingBusyChange?: (v: boolean) => void;
  autoTimingProgress?: number;
  onAutoTimingProgressChange?: (v: number) => void;
  autoTimingStage?: 'separate' | 'align' | null;
  onAutoTimingStageChange?: (s: 'separate' | 'align' | null) => void;
  bpmProgress?: number;
  onBpmProgressChange?: (v: number) => void;
}

export default function TimingView({
  lyrics,
  state,
  onStateChange,
  onUndoRecord,
  onUndo,
  onRedo,
  canUndo: canUndoProp,
  canRedo: canRedoProp,
  renderVersion,
  onRequestRender,
  snack,
  audioEngine,
  audioDuration,
  audioFileName,
  onAudioChange,
  detectingBpm,
  onDetectingBpmChange,
  autoTimingBusy,
  onAutoTimingBusyChange,
  autoTimingProgress,
  onAutoTimingProgressChange,
  autoTimingStage,
  onAutoTimingStageChange,
  bpmProgress,
  onBpmProgressChange,
}: TimingViewProps) {
  const {
    currentTime,
    isPlaying,
    currentTimeRef,
    handleSeek,
    togglePlay,
    setCurrentTime,
    setIsPlaying,
    zoomLevel,
    setZoomLevel,
    scrollOffset,
    setScrollOffset,
    compensationMs,
    setCompensationMs,
    verticalZoom,
    setVerticalZoom,
    verticalOffset,
    setVerticalOffset,
    multiLine,
    setMultiLine,
    timelineView,
    setTimelineView,
    snapToGrid,
    setSnapToGrid,
    speed,
    setSpeed,
  } = useTimingRuntime();

  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragCurrentTimeMs, setDragCurrentTimeMs] = useState<number | null>(
    null,
  );
  const [bpmDragTimeMs, setBpmDragTimeMs] = useState<number | null>(null);
  const [bpmDragIdx, setBpmDragIdx] = useState<number | null>(null);
  const dragRef = useRef<{
    startX: number;
    startTimeMs: number;
    wordIndex: number;
    sylIndex: number;
    offsetMs: number;
  } | null>(null);
  const bpmDragRef = useRef<{
    segIndex: number;
    startTimeMs: number;
    offsetMs: number;
  } | null>(null);
  const [editingBeatIndex, setEditingBeatIndex] = useState<number | null>(null);
  const [editingWordIndex, setEditingWordIndex] = useState<number | null>(null);
  const [editingTimeValue, setEditingTimeValue] = useState('');
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [autoTimingDialog, setAutoTimingDialog] = useState<{
    languages: Array<{ code: string; id: number }>;
  } | null>(null);
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
  const lyricsRef = useRef<HTMLDivElement>(null);
  const columnsRowRef = useRef<HTMLDivElement>(null);

  const updateState = useCallback(
    (next: TimingState) => {
      onStateChange?.(next);
    },
    [onStateChange],
  );

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

  const handleDetectBpm = useCallback(async () => {
    const rawData = audioEngine?.rawData;
    if (!rawData || rawData.length === 0) {
      snack?.show('请先导入音频');
      return;
    }
    onDetectingBpmChange?.(true);
    // Flush React state so button shows "分析中…" before blocking IPC
    await new Promise((r) => setTimeout(r, 16));
    try {
      const result = await detectRhythm(rawData, audioEngine!.sampleRate);
      updateState({
        ...state,
        fineTune: { ...state.fineTune, bpmSegments: result.segments },
      });
      setSnapToGrid(true);
      onUndoRecord?.();
      snack?.show(`BPM 检测完成：${result.bpm}，网格已开启`);
    } catch (err) {
      snack?.show('BPM 检测失败');
      console.error(err);
    } finally {
      onDetectingBpmChange?.(false);
    }
  }, [
    audioEngine,
    snack,
    updateState,
    state,
    onUndoRecord,
    onDetectingBpmChange,
  ]);

  const handleAutoTiming = useCallback(async () => {
    if (!state.audioFilePath) {
      snack?.show('请先导入音频');
      return;
    }
    try {
      const check = await checkAutoTiming();
      const problems: string[] = [];
      if (!check.separateModelOk) problems.push('缺少人声分离模型');
      if (!check.whisperModelOk)
        problems.push('缺少 whisper 模型或模型不支持多语言');
      if (problems.length > 0) {
        snack?.show(
          `自动打轴不可用：${problems.join('、')}，请检查「资源配置」`,
        );
        return;
      }
      setAutoTimingDialog({ languages: check.whisperLanguages });
    } catch (err) {
      snack?.show('自动打轴检查失败');
      console.error('[auto timing check]', err);
    }
  }, [state.audioFilePath, snack]);

  const handleAutoTimingConfirm = useCallback(
    async (options: AutoTimingOptions) => {
      setAutoTimingDialog(null);
      if (!state.audioFilePath) return;
      onAutoTimingBusyChange?.(true);
      try {
        // 1. read + decode audio (Chromium built-in codecs)
        snack?.show('正在解码音频…');
        const buf = await readAudioBuffer(state.audioFilePath);
        const ctx = new AudioContext();
        const decoded = await ctx.decodeAudioData(buf);
        await ctx.close();
        const channels: Float32Array[] = [];
        const nCh = Math.min(decoded.numberOfChannels, 2);
        for (let c = 0; c < nCh; c++) channels.push(decoded.getChannelData(c));
        if (channels.length === 0) {
          snack?.show('音频解码失败');
          return;
        }

        // 2. export target (only when exporting)
        let outputDir: string | null = null;
        let exportBaseName: string | null = null;
        if (options.exportVocals) {
          const p = state.audioFilePath.replace(/\\/g, '/');
          const lastSlash = p.lastIndexOf('/');
          const dir = lastSlash >= 0 ? p.slice(0, lastSlash) : '';
          const file = lastSlash >= 0 ? p.slice(lastSlash + 1) : p;
          const dot = file.lastIndexOf('.');
          outputDir = dir;
          exportBaseName = dot > 0 ? file.slice(0, dot) : file;
        }

        // 3. separate (or reuse a cached `音频名-vocal.wav` when it matches
        //    the source duration — separation is skipped entirely, so the
        //    export checkboxes are ignored for cached runs)
        onAutoTimingProgressChange?.(0);
        onAutoTimingStageChange?.('separate');
        let sep: SeparateResult | undefined;
        const cachePath = options.useSeparateCache
          ? vocalCachePath(state.audioFilePath)
          : null;
        if (cachePath) {
          const info = await getWavInfo(cachePath);
          const srcDur = decoded.duration;
          const cacheDur = info ? info.frames / info.sampleRate : 0;
          if (info && Math.abs(cacheDur - srcDur) < 0.25) {
            sep = { vocalsPath: cachePath, exported: [] };
            snack?.show('使用分离缓存…');
          } else {
            snack?.show('未找到匹配的分离缓存，重新分离…');
          }
        }
        if (!sep) {
          sep = await separateVocals(
            channels,
            decoded.sampleRate,
            {
              computeInstru: options.exportVocals,
              outputDir,
              exportBaseName,
            },
            (p) => onAutoTimingProgressChange?.(p),
          );
        }

        if (options.separateOnly) {
          snack?.show(
            options.exportVocals
              ? `分离完成，已输出 ${sep.exported.length} 个文件`
              : '分离完成',
          );
          return;
        }

        // 4. align
        onAutoTimingProgressChange?.(0);
        onAutoTimingStageChange?.('align');
        snack?.show('正在 whisper 对齐…');
        const clean =
          options.cleanVocal !== false
            ? { enabled: true, threshold: options.cleanThreshold ?? 12 }
            : { enabled: false, threshold: 0 };
        const segments = await alignVocals(
          sep.vocalsPath,
          options.languageToken,
          clean,
          (p) => onAutoTimingProgressChange?.(p),
        );
        if (!segments || segments.length === 0) {
          snack?.show('whisper 未检测到有效内容');
          return;
        }

        // 5. apply
        alignSegmentsToLyrics(segments, lyrics);
        if (options.snapToBeat) {
          snapToBeatGrid(lyrics, state.fineTune.bpmSegments);
        }
        // 6. infer separator (space/newline) times, like manual timing does
        const refs = lyrics.getBeatRefs();
        for (let bi = 0; bi < refs.length; bi++) {
          inferSeparatorTimes(lyrics, bi);
        }
        onRequestRender?.();
        onUndoRecord?.();
        snack?.show(`自动打轴完成（${segments.length} 段）`);
      } catch (err) {
        snack?.show('自动打轴失败');
        console.error('[auto timing]', err);
      } finally {
        onAutoTimingBusyChange?.(false);
        onAutoTimingStageChange?.(null);
        onAutoTimingProgressChange?.(-1);
      }
    },
    [
      state.audioFilePath,
      snack,
      lyrics,
      onRequestRender,
      onUndoRecord,
      onAutoTimingBusyChange,
      onAutoTimingProgressChange,
      onAutoTimingStageChange,
    ],
  );

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
    onUndoRecord?.();
    onRequestRender?.();
  }, [
    lyrics,
    state,
    updateState,
    onUndoRecord,
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
    onUndoRecord?.();
    onRequestRender?.();
  }, [lyrics, state, updateState, onUndoRecord, onRequestRender]);

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

  useTimingKeyboard({
    handleSetBeat,
    handleClearBeat,
    togglePlay,
    updateState,
    state,
    lyrics,
    setVerticalZoom,
    setVerticalOffset,
    timelineView,
  });

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
      lyrics.setSyllableTime(wordIndex, sylIndex, {
        msec: Math.round(newTimeMs),
      });
      updateState({ ...state });
      onUndoRecord?.();
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
    onUndoRecord,
  ]);

  // ── BPM segment drag ──

  const handleBpmDragStart = useCallback(
    (e: React.MouseEvent, i: number, startMs: number) => {
      e.preventDefault();
      setBpmDragIdx(i);
      setBpmDragTimeMs(startMs);
      const el = document.querySelector('.tv-finetune');
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const visibleMs = audioDuration / zoomLevel;
      const fromMs = scrollOffset;
      const mouseTime =
        fromMs + ((e.clientX - rect.left) / rect.width) * visibleMs;
      const offsetMs = mouseTime - startMs;
      bpmDragRef.current = { segIndex: i, startTimeMs: startMs, offsetMs };
    },
    [audioDuration, zoomLevel, scrollOffset],
  );

  useEffect(() => {
    if (bpmDragIdx === null) return;
    const el = document.querySelector('.tv-finetune');
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
          fromMs + ratio * visibleMs - (bpmDragRef.current?.offsetMs ?? 0),
        ),
      );
    };

    const handleMove = (e: MouseEvent) => {
      setBpmDragTimeMs(computeTime(e.clientX));
    };

    const handleUp = (e: MouseEvent) => {
      if (!bpmDragRef.current) return;
      const timeMs = computeTime(e.clientX);

      const segs = [...state.fineTune.bpmSegments]
        .map((s, idx) =>
          idx === bpmDragRef.current!.segIndex
            ? { ...s, start: Math.round(timeMs) }
            : s,
        )
        .sort((a, b) => a.start - b.start);
      updateState({
        ...state,
        fineTune: { ...state.fineTune, bpmSegments: segs },
      });
      onUndoRecord?.();
      setBpmDragIdx(null);
      setBpmDragTimeMs(null);
      bpmDragRef.current = null;
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      setBpmDragTimeMs(null);
    };
  }, [
    bpmDragIdx,
    audioDuration,
    zoomLevel,
    scrollOffset,
    state,
    updateState,
    onUndoRecord,
  ]);

  // Auto-scroll lyrics to keep selected beat visible.
  // Only scrolls when selectedBeatIndex actually changes (user interaction),
  // not on every re-render during playback.
  const prevBeatRef = useRef(state.selectedBeatIndex);
  useEffect(() => {
    if (state.selectedBeatIndex < 0) return;
    // Skip if selection hasn't changed (e.g., viewData re-render during playback)
    if (state.selectedBeatIndex === prevBeatRef.current && isPlaying) return;
    prevBeatRef.current = state.selectedBeatIndex;

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
      const w = lyrics.words[editingWordIndex];
      w.syllables[0] = setSyllableTime(w.syllables[0], parsed);
      // Update state to clear any pending beats related to this separator
      updateState({ ...state });
      onUndoRecord?.();
    } else if (editingBeatIndex >= 0) {
      if (isMultiLineRef.current) {
        // Multi-line view: edit only the specific syllable
        const stateWithBeat = { ...state, selectedBeatIndex: editingBeatIndex };
        setBeatTime(lyrics, stateWithBeat, parsed.msec);
        const ns = postSetBeat(lyrics, stateWithBeat, editingBeatIndex);
        if (ns !== stateWithBeat) updateState(ns);
        onUndoRecord?.();
      } else {
        // Single-line view: shift all syllables of the word by offset
        const refs = lyrics.getBeatRefs();
        if (editingBeatIndex < 0 || editingBeatIndex >= refs.length) return;
        const ref = refs[editingBeatIndex];
        const word = lyrics.words[ref.wordIndex];

        const firstSyl = word.syllables[0];
        if (firstSyl.isSet) {
          const offset = parsed.msec - firstSyl.time.msec;
          for (let i = 0; i < word.syllables.length; i += 1) {
            const syl = word.syllables[i];
            if (syl.isSet) {
              word.syllables[i] = setSyllableTime(syl, {
                msec: Math.max(0, syl.time.msec + offset),
              });
            }
          }
        } else {
          // First syllable was unset, set it directly
          word.syllables[0] = setSyllableTime(firstSyl, parsed);
        }
        const ns = postSetBeat(lyrics, state, editingBeatIndex);
        if (ns !== state) updateState(ns);
        onUndoRecord?.();
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
    onUndoRecord,
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
      const w = lyrics.words[cardCtxMenu.wordIndex];
      for (let i = 0; i < w.syllables.length; i += 1) {
        w.syllables[i] = unsetSyllableTime(w.syllables[i]);
      }
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
      const w = lyrics.words[ref.wordIndex];
      for (let i = 0; i < w.syllables.length; i += 1) {
        w.syllables[i] = unsetSyllableTime(w.syllables[i]);
      }
    }
    onUndoRecord?.();
    setCardCtxMenu(null);
    onRequestRender?.();
  }, [cardCtxMenu, lyrics, state, onUndoRecord, onRequestRender]);

  const handleCardCtxShift = useCallback(
    (delta: number) => {
      if (!cardCtxMenu) return;
      if (cardCtxMenu.wordIndex !== undefined) {
        const w = lyrics.words[cardCtxMenu.wordIndex];
        for (let i = 0; i < w.syllables.length; i += 1) {
          const syl = w.syllables[i];
          if (syl.isSet) {
            w.syllables[i] = setSyllableTime(syl, {
              msec: Math.max(0, syl.time.msec + delta),
            });
          }
        }
      } else if (isMultiLineRef.current) {
        // Multi-line view: shift only this syllable
        const refs = lyrics.getBeatRefs();
        const ref = refs[cardCtxMenu.beatIndex];
        const w = lyrics.words[ref.wordIndex];
        const syl = w.syllables[ref.sylIndex];
        const current = syl.isSet ? syl.time.msec : 0;
        w.syllables[ref.sylIndex] = setSyllableTime(syl, {
          msec: Math.max(0, current + delta),
        });
      } else {
        // Single-line view: shift all set syllables of the word
        const refs = lyrics.getBeatRefs();
        const ref = refs[cardCtxMenu.beatIndex];
        const w = lyrics.words[ref.wordIndex];
        for (let i = 0; i < w.syllables.length; i += 1) {
          const syl = w.syllables[i];
          if (syl.isSet) {
            w.syllables[i] = setSyllableTime(syl, {
              msec: Math.max(0, syl.time.msec + delta),
            });
          }
        }
      }
      onUndoRecord?.();
      setCardCtxMenu(null);
      onRequestRender?.();
    },
    [cardCtxMenu, lyrics, onUndoRecord, onRequestRender],
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
        onDetectBpm={handleDetectBpm}
        detectingBpm={detectingBpm ?? false}
        onAutoTiming={handleAutoTiming}
        autoTimingBusy={autoTimingBusy}
        bpmProgress={bpmProgress}
        autoTimingProgress={autoTimingProgress}
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
            onBpmDragStart={handleBpmDragStart}
            bpmDragIdx={bpmDragIdx}
            bpmDragTimeMs={bpmDragTimeMs}
            onUpdateBpm={(i, bpm) => {
              const segs = [...state.fineTune.bpmSegments].sort(
                (a, b) => a.start - b.start,
              );
              if (segs[i]) segs[i] = { ...segs[i], bpm };
              updateState({
                ...state,
                fineTune: { ...state.fineTune, bpmSegments: segs },
              });
              onUndoRecord?.();
            }}
            onUpdateStartTime={(i, start) => {
              const segs = [...state.fineTune.bpmSegments]
                .map((s, idx) => (idx === i ? { ...s, start } : s))
                .sort((a, b) => a.start - b.start);
              updateState({
                ...state,
                fineTune: { ...state.fineTune, bpmSegments: segs },
              });
              onUndoRecord?.();
            }}
            onDeleteSegment={(i) => {
              const segs = [...state.fineTune.bpmSegments]
                .filter((_, idx) => idx !== i)
                .sort((a, b) => a.start - b.start);
              updateState({
                ...state,
                fineTune: { ...state.fineTune, bpmSegments: segs },
              });
              onUndoRecord?.();
            }}
            onAddSegment={(start, bpm) => {
              const segs = [...state.fineTune.bpmSegments, { start, bpm }].sort(
                (a, b) => a.start - b.start,
              );
              updateState({
                ...state,
                fineTune: { ...state.fineTune, bpmSegments: segs },
              });
              onUndoRecord?.();
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
          bpmDragTimeMs={timelineView ? bpmDragTimeMs : undefined}
          verticalZoom={verticalZoom}
          verticalOffset={verticalOffset}
        />
      </div>

      {ctxMenu && (
        <TimingCanvasCtxMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          canUndo={canUndoProp?.() ?? false}
          canRedo={canRedoProp?.() ?? false}
          audioEngine={!!audioEngine}
          isPlaying={isPlaying}
          onClose={() => setCtxMenu(null)}
          onUndo={() => {
            onUndo?.();
            onRequestRender?.();
          }}
          onRedo={() => {
            onRedo?.();
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
      {autoTimingDialog && (
        <AutoTimingDialog
          languages={autoTimingDialog.languages}
          onConfirm={handleAutoTimingConfirm}
          onCancel={() => setAutoTimingDialog(null)}
        />
      )}
      {/* Bottom bar */}
      <div className="tv-bottom" style={{ position: 'relative' }}>
        {autoTimingBusy &&
          autoTimingStage &&
          (autoTimingProgress ?? -1) >= 0 && (
            <div
              className="tv-progress"
              style={{
                position: 'absolute',
                left: '50%',
                top: 0,
                bottom: 0,
                transform: 'translateX(-50%)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                pointerEvents: 'none',
              }}
            >
              <span className="tv-progress-label">
                {autoTimingStage === 'separate' ? '分离中' : '对齐中'}
              </span>
              <div className="tv-progress-track">
                <div
                  className="tv-progress-fill"
                  style={{
                    width: `${Math.min(
                      100,
                      Math.max(0, Math.round((autoTimingProgress ?? 0) * 100)),
                    )}%`,
                  }}
                />
              </div>
              <span className="tv-progress-pct">
                {Math.min(
                  100,
                  Math.max(0, Math.round((autoTimingProgress ?? 0) * 100)),
                )}
                %
              </span>
            </div>
          )}
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
