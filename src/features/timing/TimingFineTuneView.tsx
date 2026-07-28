import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useClickOutside } from '../../shared/hooks/useClickOutside';
import { parseTime, formatTime } from '../../editor/time';
import type { BpmSegment } from '../../timing/types';

interface TimingFineTuneViewProps {
  bpmSegments: BpmSegment[];
  zoomLevel: number;
  scrollOffset: number;
  duration: number;
  snack?: { show: (msg: string, durationMs?: number) => void };
  onUpdateBpm: (index: number, bpm: number) => void;
  onUpdateStartTime: (index: number, start: number) => void;
  onDeleteSegment: (index: number) => void;
  onAddSegment: (start: number, bpm: number) => void;
  onSeek: (timeMs: number) => void;
  onBpmDragStart?: (e: React.MouseEvent, i: number, startMs: number) => void;
  bpmDragIdx?: number | null;
  bpmDragTimeMs?: number | null;
  audioLoaded?: boolean;
}

export default function TimingFineTuneView({
  bpmSegments,
  zoomLevel,
  scrollOffset,
  duration,
  snack,
  onUpdateBpm,
  onUpdateStartTime,
  onDeleteSegment,
  onAddSegment,
  onSeek,
  onBpmDragStart,
  bpmDragIdx,
  bpmDragTimeMs,
  audioLoaded,
}: TimingFineTuneViewProps) {
  const sorted = useMemo(
    () => [...bpmSegments].sort((a, b) => a.start - b.start),
    [bpmSegments],
  );
  const containerRef = useRef<HTMLDivElement>(null);

  const visibleMs = duration / zoomLevel;
  const fromMs = scrollOffset;

  // Get BPM at a given time by finding the latest segment whose start ≤ time
  const getBpmAt = useCallback(
    (timeMs: number): number | null => {
      let bpm: number | null = null;
      sorted.forEach((seg) => {
        if (seg.start <= timeMs) bpm = seg.bpm;
      });
      return bpm;
    },
    [sorted],
  );

  // ── Context menu state ──
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    segIndex?: number;
    clickTimeMs?: number;
  } | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);
  useClickOutside(ctxRef, !!ctxMenu, () => setCtxMenu(null));

  const handleCardMouseDown = useCallback(
    (e: React.MouseEvent, i: number, segStart: number) => {
      if (!audioLoaded) return;
      onBpmDragStart?.(e, i, segStart);
    },
    [onBpmDragStart, audioLoaded],
  );

  // ── Modal state ──
  const [modal, setModal] = useState<{
    type: 'bpm' | 'time' | 'newSeg' | 'hereBpm';
    segIndex?: number;
    clickTimeMs?: number;
  } | null>(null);
  const [modalValue, setModalValue] = useState('');
  const modalRef = useRef<HTMLDivElement>(null);

  const handleCardContext = useCallback((e: React.MouseEvent, i: number) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, segIndex: i });
  }, []);

  const handleBlankContext = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      const clickTimeMs = fromMs + ratio * visibleMs;
      setCtxMenu({ x: e.clientX, y: e.clientY, clickTimeMs });
    },
    [fromMs, visibleMs],
  );

  const findSegIndex = useCallback(
    (timeMs: number): number => {
      let best = -1;
      let bestDist = Infinity;
      sorted.forEach((seg, i) => {
        const d = Math.abs(seg.start - timeMs);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      return best;
    },
    [sorted],
  );

  const openModal = useCallback((t: typeof modal, defaultVal: string) => {
    setModal(t);
    setModalValue(defaultVal);
    setCtxMenu(null);
  }, []);

  const handleModalConfirm = useCallback(() => {
    if (!modal) return;
    const raw = modalValue.trim();
    if (modal.type === 'bpm' && modal.segIndex !== undefined) {
      const bpm = parseInt(raw, 10);
      if (bpm >= 0) {
        onUpdateBpm(modal.segIndex, bpm);
        setModal(null);
      } else snack?.show('BPM 必须为非负整数');
    } else if (modal.type === 'time' && modal.segIndex !== undefined) {
      const parsed = parseTime(raw);
      if (parsed.msec >= 0 && /[0-9]/.test(raw)) {
        onUpdateStartTime(modal.segIndex, Math.round(parsed.msec));
        setModal(null);
      } else snack?.show('时间格式无效');
    } else if (modal.type === 'newSeg' && modal.clickTimeMs !== undefined) {
      const bpm = parseInt(raw, 10);
      if (bpm >= 0) {
        onAddSegment(modal.clickTimeMs, bpm);
        setModal(null);
      } else snack?.show('BPM 必须为非负整数');
    } else {
      setModal(null);
    }
  }, [modal, modalValue, snack, onUpdateBpm, onUpdateStartTime, onAddSegment]);

  return (
    <div
      className="tv-finetune"
      ref={containerRef}
      onContextMenu={handleBlankContext}
    >
      {sorted.map((seg, i) => {
        const isDragging = bpmDragIdx === i;
        const displayTime: number =
          isDragging && bpmDragTimeMs != null ? bpmDragTimeMs : seg.start;
        const x = ((displayTime - fromMs) / visibleMs) * 100;
        const isVisible =
          seg.start >= fromMs && seg.start <= fromMs + visibleMs;

        return (
          <div
            key={i}
            className={`tv-bpm-card${isDragging ? ' tv-bpm-card-dragging' : ''}`}
            style={{
              position: 'absolute',
              left: `${x}%`,
              display: isVisible || isDragging ? 'flex' : 'none',
              cursor: 'ew-resize',
              userSelect: 'none',
            }}
            onContextMenu={(e) => handleCardContext(e, i)}
            onMouseDown={(e) => handleCardMouseDown(e, i, seg.start)}
          >
            ♩= {seg.bpm}
          </div>
        );
      })}

      {/* ── Context menu ── */}
      {ctxMenu && (
        <div
          ref={ctxRef}
          className="shared-ctx-menu"
          style={{
            position: 'fixed',
            left: ctxMenu.x,
            top: ctxMenu.y,
            zIndex: 1000,
          }}
        >
          {(() => {
            const segIdx = ctxMenu.segIndex;
            if (segIdx === undefined) {
              // No segment selected — show "new segment" actions
              return (
                <>
                  <button
                    className="shared-ctx-item"
                    disabled={!audioLoaded}
                    onClick={() =>
                      openModal(
                        { type: 'newSeg', clickTimeMs: ctxMenu.clickTimeMs },
                        '120',
                      )
                    }
                  >
                    新建BPM分段
                  </button>
                  <div className="shared-ctx-sep" />
                  <button
                    className="shared-ctx-item"
                    disabled={!audioLoaded || sorted.length === 0}
                    onClick={() => {
                      let prev = -1;
                      sorted.forEach((seg, i) => {
                        if (seg.start < ctxMenu.clickTimeMs!) prev = i;
                      });
                      if (prev >= 0) onSeek(sorted[prev].start);
                      setCtxMenu(null);
                    }}
                  >
                    跳到上一个分段
                  </button>
                  <button
                    className="shared-ctx-item"
                    disabled={!audioLoaded || sorted.length === 0}
                    onClick={() => {
                      const next = sorted.findIndex(
                        (seg) => seg.start > ctxMenu.clickTimeMs!,
                      );
                      if (next >= 0) onSeek(sorted[next].start);
                      setCtxMenu(null);
                    }}
                  >
                    跳到下一个分段
                  </button>
                  <div className="shared-ctx-sep" />
                  <button className="shared-ctx-item" disabled>
                    此处BPM值：
                    {ctxMenu.clickTimeMs !== undefined
                      ? `${getBpmAt(ctxMenu.clickTimeMs) ?? '—'}`
                      : '—'}
                  </button>
                </>
              );
            }
            // Segment selected — show segment actions
            const seg = sorted[segIdx];
            return (
              <>
                <button
                  className="shared-ctx-item"
                  onClick={() =>
                    openModal(
                      { type: 'bpm', segIndex: segIdx },
                      String(seg.bpm),
                    )
                  }
                >
                  修改BPM值
                </button>
                <button
                  className="shared-ctx-item"
                  onClick={() =>
                    openModal(
                      { type: 'time', segIndex: segIdx },
                      formatTime(
                        { msec: Math.round(seg.start) },
                        '.',
                        false,
                        false,
                      ),
                    )
                  }
                >
                  调整起始时间
                </button>
                <div className="shared-ctx-sep" />
                <button
                  className="shared-ctx-item"
                  onClick={() => {
                    onDeleteSegment(segIdx);
                    setCtxMenu(null);
                  }}
                >
                  删除此分段
                </button>
              </>
            );
          })()}
        </div>
      )}

      {/* ── Modal (editor-style overlay) ── */}
      {modal && modal.type !== 'hereBpm' && (
        <div className="rem-overlay" onClick={() => setModal(null)}>
          <div
            className="rem-modal"
            onClick={(e) => e.stopPropagation()}
            ref={modalRef}
            style={{ minWidth: '280px' }}
          >
            <div className="rem-header">
              <span className="rem-title">
                {modal.type === 'bpm'
                  ? '修改BPM值'
                  : modal.type === 'time'
                    ? '调整起始时间'
                    : '新建BPM分段'}
              </span>
              <button
                type="button"
                className="rem-close"
                onClick={() => setModal(null)}
              >
                <span className="mdi mdi-close" />
              </button>
            </div>
            <div className="rem-body">
              <div className="rem-row">
                <span className="rem-label">
                  {modal.type === 'bpm'
                    ? 'BPM'
                    : modal.type === 'time'
                      ? '时间（m:s.ms）'
                      : 'BPM'}
                </span>
                <input
                  className="rem-input"
                  type="text"
                  value={modalValue}
                  onChange={(e) => setModalValue(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') handleModalConfirm();
                  }}
                  autoFocus
                />
              </div>
            </div>
            <div className="rem-footer">
              <button
                type="button"
                className="shared-btn"
                onClick={() => setModal(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="shared-btn shared-btn-primary"
                onClick={handleModalConfirm}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
