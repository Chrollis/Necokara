import { useRef, useEffect, useCallback } from 'react';
import type AudioEngine from './AudioEngine';

interface WaveformProps {
  engine: AudioEngine | null;
  duration: number; // ms
  currentTime: number;
  zoomLevel?: number;
  scrollOffset?: number;
  verticalZoom?: number;
  verticalOffset?: number;
  onSeek?: (timeMs: number) => void;
  timeRef?: React.MutableRefObject<number>;
  beatTimesMs?: readonly number[];
  selectedBeatTimeMs?: number | null;
}

export default function Waveform({
  engine, duration, currentTime,
  zoomLevel = 1, scrollOffset = 0,
  verticalZoom = 1, verticalOffset = 0,
  onSeek, timeRef,
  beatTimesMs, selectedBeatTimeMs,
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cacheRef = useRef<ImageData | null>(null);
  const wavePathRef = useRef<Array<{ x: number; y: number }>>([]);
  const drawParamsRef = useRef({ w: 0, h: 0, z: 0, s: 0 });
  const selectedBeatTimeRef = useRef<number | null>(null);
  selectedBeatTimeRef.current = selectedBeatTimeMs ?? null;

  // ── Draw static waveform (blue) ──
  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (cssW === 0 || cssH === 0) return;

    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== cssW * dpr) { canvas.width = cssW * dpr; canvas.height = cssH * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = cssW;
    const h = cssH;

    ctx.fillStyle = '#201d1d';
    ctx.fillRect(0, 0, w, h);

    if (!engine || duration <= 0) {
      ctx.fillStyle = '#646262';
      ctx.font = '14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('导入音频文件以显示波形', w / 2, h / 2);
      cacheRef.current = null;
      wavePathRef.current = [];
      drawParamsRef.current = { w: 0, h: 0, z: 0, s: 0 };
      return;
    }

    const visibleMs = duration / zoomLevel;
    const fromMs = scrollOffset;
    const toMs = fromMs + visibleMs;
    const fromRatio = fromMs / duration;
    const toRatio = toMs / duration;

    const visibleRatio = (toRatio - fromRatio) || 0.001;
    const totalPeaks = Math.max(2, Math.ceil(400 / visibleRatio));
    const raw = engine.getPeaks(totalPeaks);
    if (raw.length < 2) return;

    const startIdx = Math.floor(fromRatio * raw.length);
    const endIdx = Math.ceil(toRatio * raw.length);
    const slice = raw.slice(Math.max(0, startIdx), Math.min(raw.length, endIdx));
    if (slice.length < 2) return;

    const mid = h / 2 + verticalOffset;
    const ampScale = h * 0.45 * verticalZoom;

    // Build waveform path data for green overlay later
    const path: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < slice.length; i += 1) {
      const x = (i / slice.length) * w;
      const y = i % 2 === 0
        ? mid - slice[i] * ampScale
        : mid + slice[i] * ampScale;
      path.push({ x, y });
    }
    wavePathRef.current = path;

    // Beat dashed lines
    if (beatTimesMs && beatTimesMs.length > 0) {
      let lastX = -Infinity;
      const sorted = [...beatTimesMs].sort((a, b) => a - b);
      sorted.forEach((t) => {
        if (t < fromMs || t > toMs) return;
        const x = ((t - fromMs) / visibleMs) * w;
        if (x - lastX < 8) return;
        lastX = x;
        ctx.strokeStyle = 'rgba(158, 158, 158, 0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      });
      ctx.setLineDash([]);
    }

    // Blue waveform (full)
    ctx.strokeStyle = '#007aff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    path.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();

    if (canvas.width > 0 && canvas.height > 0) {
      cacheRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
    }
    drawParamsRef.current = { w, h, z: zoomLevel, s: scrollOffset };
  }, [engine, duration, zoomLevel, scrollOffset, beatTimesMs, verticalZoom, verticalOffset]);

  // ── Animation loop: restore cache + green overlay + markers ──
  useEffect(() => {
    let animId = 0;
    const loop = () => {
      const canvas = canvasRef.current;
      if (!canvas) { animId = requestAnimationFrame(loop); return; }
      const ctx = canvas.getContext('2d');
      if (!ctx) { animId = requestAnimationFrame(loop); return; }
      const dpr = window.devicePixelRatio || 1;
      const cssH = canvas.clientHeight;
      if (cssH === 0) { animId = requestAnimationFrame(loop); return; }

      const cache = cacheRef.current;
      const path = wavePathRef.current;
      if (!cache || path.length === 0) { animId = requestAnimationFrame(loop); return; }

      // Restore cached blue waveform
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.putImageData(cache, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const p = drawParamsRef.current;
      if (p.w > 0 && duration > 0) {
        const visibleMs = duration / p.z;
        const fromMs = p.s;
        const ct = timeRef ? timeRef.current : currentTime;

        // Green overlay for played portion
        if (ct > fromMs) {
          const ratio = Math.min(1, Math.max(0, (ct - fromMs) / visibleMs));
          const count = Math.floor(path.length * ratio);
          if (count > 1) {
            ctx.strokeStyle = '#30d158';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let i = 0; i < count; i += 1) {
              if (i === 0) ctx.moveTo(path[i].x, path[i].y);
              else ctx.lineTo(path[i].x, path[i].y);
            }
            ctx.stroke();
          }
        }

        // Selected beat marker (yellow)
        const selTime = selectedBeatTimeRef.current;
        if (selTime != null && selTime >= fromMs && selTime <= fromMs + visibleMs) {
          const sx = ((selTime - fromMs) / visibleMs) * p.w;
          ctx.strokeStyle = '#ffd60a';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(sx, 0);
          ctx.lineTo(sx, cssH);
          ctx.stroke();
        }

        // Playhead (red line)
        const phX = ((ct - fromMs) / visibleMs) * p.w;
        if (phX >= 0 && phX <= p.w) {
          ctx.strokeStyle = '#ff3b30';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(phX, 0);
          ctx.lineTo(phX, cssH);
          ctx.stroke();
        }
      }
      animId = requestAnimationFrame(loop);
    };
    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [timeRef, currentTime, duration]);

  useEffect(() => { drawWaveform(); }, [drawWaveform]);

  useEffect(() => {
    const handleResize = () => drawWaveform();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [drawWaveform]);

  const handleClick = (e: React.MouseEvent) => {
    if (!onSeek || !engine || duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const visibleMs = duration / zoomLevel;
    const fromMs = scrollOffset;
    onSeek(fromMs + ratio * visibleMs);
  };

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair' }}
      onClick={handleClick}
    />
  );
}

