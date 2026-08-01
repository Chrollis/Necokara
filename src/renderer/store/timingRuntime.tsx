/**
 * timingRuntime.tsx — global runtime state for the timing view (playback +
 * view preferences), kept above the view switch so that leaving/returning to
 * the timing page does not lose the playhead or layout settings while the
 * AudioEngine (owned by App) keeps playing.
 *
 * Playback animation loop, seek/play toggling and playback-rate sync all live
 * here since they depend on the global audioEngine.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type AudioEngine from '../../features/timing/AudioEngine';

interface TimingRuntimeValue {
  // playback
  currentTime: number;
  isPlaying: boolean;
  currentTimeRef: React.MutableRefObject<number>;
  handleSeek: (timeMs: number) => void;
  togglePlay: () => void;
  setCurrentTime: Dispatch<SetStateAction<number>>;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  // view preferences
  zoomLevel: number;
  setZoomLevel: Dispatch<SetStateAction<number>>;
  scrollOffset: number;
  setScrollOffset: Dispatch<SetStateAction<number>>;
  compensationMs: number;
  setCompensationMs: Dispatch<SetStateAction<number>>;
  verticalZoom: number;
  setVerticalZoom: Dispatch<SetStateAction<number>>;
  verticalOffset: number;
  setVerticalOffset: Dispatch<SetStateAction<number>>;
  multiLine: boolean;
  setMultiLine: Dispatch<SetStateAction<boolean>>;
  timelineView: boolean;
  setTimelineView: Dispatch<SetStateAction<boolean>>;
  snapToGrid: boolean;
  setSnapToGrid: Dispatch<SetStateAction<boolean>>;
  speed: number;
  setSpeed: Dispatch<SetStateAction<number>>;
}

const TimingRuntimeContext = createContext<TimingRuntimeValue | null>(null);

export function TimingRuntimeProvider({
  audioEngine,
  audioDuration,
  children,
}: {
  audioEngine: AudioEngine | null;
  audioDuration: number;
  children: ReactNode;
}) {
  // playback
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const currentTimeRef = useRef(0);
  const animRef = useRef(0);

  // view preferences
  const [zoomLevel, setZoomLevel] = useState(1);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [compensationMs, setCompensationMs] = useState(0);
  const [verticalZoom, setVerticalZoom] = useState(1);
  const [verticalOffset, setVerticalOffset] = useState(0);
  const [multiLine, setMultiLine] = useState(false);
  const [timelineView, setTimelineView] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [speed, setSpeed] = useState(1.0);

  // Playback animation loop (drives the playhead while audio plays)
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

  // Keep the engine's playback rate in sync while speed lives here
  useEffect(() => {
    audioEngine?.setPlaybackRate(speed);
  }, [audioEngine, speed]);

  const value = useMemo<TimingRuntimeValue>(
    () => ({
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
    }),
    [
      currentTime,
      isPlaying,
      handleSeek,
      togglePlay,
      zoomLevel,
      scrollOffset,
      compensationMs,
      verticalZoom,
      verticalOffset,
      multiLine,
      timelineView,
      snapToGrid,
      speed,
    ],
  );

  return (
    <TimingRuntimeContext.Provider value={value}>
      {children}
    </TimingRuntimeContext.Provider>
  );
}

export function useTimingRuntime(): TimingRuntimeValue {
  const ctx = useContext(TimingRuntimeContext);
  if (!ctx) {
    throw new Error(
      'useTimingRuntime must be used within TimingRuntimeProvider',
    );
  }
  return ctx;
}
