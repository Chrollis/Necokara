import { useState, useEffect, useCallback, useRef } from 'react';
import type AudioEngine from '../AudioEngine';

interface UseAudioPlaybackOptions {
  audioEngine: AudioEngine | null;
  audioDuration: number;
}

interface UseAudioPlaybackReturn {
  currentTime: number;
  isPlaying: boolean;
  currentTimeRef: React.MutableRefObject<number>;
  handleSeek: (timeMs: number) => void;
  togglePlay: () => void;
  setCurrentTime: React.Dispatch<React.SetStateAction<number>>;
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
}

export default function useAudioPlayback({
  audioEngine,
  audioDuration,
}: UseAudioPlaybackOptions): UseAudioPlaybackReturn {
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const currentTimeRef = useRef(0);
  const animRef = useRef<number>(0);

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

  return {
    currentTime,
    isPlaying,
    currentTimeRef,
    handleSeek,
    togglePlay,
    setCurrentTime,
    setIsPlaying,
  };
}
