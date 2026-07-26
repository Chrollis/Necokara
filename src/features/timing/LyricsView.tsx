import type { WordDisplayInfo } from '../../timing/types';
import { formatTime } from '../../editor/time';
import WordCard from '../../shared/components/WordCard';

// ── Single-line: TimingWordCard ──

export function TimingWordCard({ wordInfo, onClick }: { wordInfo: WordDisplayInfo; onClick?: () => void }) {
  const rubyText = wordInfo.withRuby && wordInfo.syllables.length > 0
    ? wordInfo.syllables.map((s) => s.reading).join('')
    : null;
  const rubyWidth = rubyText ? rubyText.length * 6 + 6 : undefined;
  const anyHighlighted = wordInfo.syllables.some((s) => s.isHighlighted);
  const allSet = wordInfo.syllables.every((s) => s.isSet);
  const hasSelected = wordInfo.hasSelectedSyllable;
  const cardCls = [
    'wc-card',
    allSet && !anyHighlighted && !hasSelected ? 'tv-syl-set' : '',
    anyHighlighted && !hasSelected ? 'tv-syl-highlighted' : '',
    hasSelected ? 'tv-syl-selected' : '',
  ].filter(Boolean).join(' ');
  return (
    <span className={rubyText ? 'wc-wrapper' : undefined} style={{ cursor: 'pointer' }} onClick={onClick}>
      {rubyText && <span className="wc-ruby-above" style={{ whiteSpace: 'nowrap' }}>{rubyText}</span>}
      <WordCard reading={wordInfo.reading} isSpace={wordInfo.isSpace} isNewline={wordInfo.isNewline} isSelected={false} cardClass={cardCls} style={rubyWidth ? { minWidth: rubyWidth } : undefined} />
    </span>
  );
}

// ── Single-line: TriangleGroup ──

export function TriangleGroup({ wordInfo, onSelectBeat }: { wordInfo: WordDisplayInfo; onSelectBeat?: (beatIndex: number) => void }) {
  return (
    <span className="tv-tri-group">
      {wordInfo.syllables.map((syl) => {
        const cls = [
          'tv-tri-cell',
          syl.isSet && !syl.isSelected ? 'tv-tri-set' : '',
          !syl.isSet && !syl.isSelected ? 'tv-tri-unset' : '',
          syl.isSelected ? 'tv-tri-cursor' : '',
        ].filter(Boolean).join(' ');
        return (
          <span key={syl.beatIndex} className={cls}
            onClick={(e) => { e.stopPropagation(); if (syl.beatIndex >= 0) onSelectBeat?.(syl.beatIndex); }}
          />
        );
      })}
    </span>
  );
}

// ── Multi-line view ──

export function MultiLineView({ viewData, onSelectBeat, editingBeatIndex, editingTimeValue, onEditingTimeChange, onFinishEditTime, onDoubleClickTime, editTimeRef, editingWordIndex, onCardContextMenu }: {
  viewData: WordDisplayInfo[];
  onSelectBeat?: (beatIndex: number) => void;
  editingBeatIndex?: number | null;
  editingTimeValue?: string;
  onEditingTimeChange?: (v: string) => void;
  onFinishEditTime?: () => void;
  onDoubleClickTime?: (beatIndex: number, wordIndex?: number) => void;
  editTimeRef?: React.RefObject<HTMLInputElement | null>;
  editingWordIndex?: number | null;
  onCardContextMenu?: (e: React.MouseEvent, beatIndex: number, wordIndex?: number) => void;
}) {
  // Build lines with wordIndex tracking
  const lineWords: Array<{ info: WordDisplayInfo; wordIndex: number }>[] = [];
  let curLine: Array<{ info: WordDisplayInfo; wordIndex: number }> = [];
  viewData.forEach((w, vi) => {
    curLine.push({ info: w, wordIndex: vi });
    if (w.isNewline) { lineWords.push(curLine); curLine = []; }
  });
  if (curLine.length > 0) lineWords.push(curLine);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: 'var(--space-sm) 0' }}>
      {lineWords.map((line, li) => {
        // Flatten each line into individual syllable items
        const sylItems: Array<{
          beatIndex: number;
          wordIndex: number;
          sylIndex: number;
            reading: string;
            timeMs: number | null;
            isSet: boolean;
            isSelected: boolean;
            isHighlighted: boolean;
            isSpace: boolean;
            isNewline: boolean;
            label: string;
          }> = [];
          line.forEach(({ info: wordInfo, wordIndex }) => {
            if (wordInfo.isSpace || wordInfo.isNewline) {
              const syl = wordInfo.syllables[0];
              sylItems.push({
                beatIndex: -1,
                wordIndex,
                sylIndex: 0,
                reading: syl.reading,
                timeMs: syl.isSet ? syl.timeMs : null,
                isSet: syl.isSet,
                isSelected: false,
                isHighlighted: syl.isHighlighted,
                isSpace: wordInfo.isSpace,
                isNewline: wordInfo.isNewline,
                label: wordInfo.isNewline ? '¶' : '…',
              });
            } else {
              wordInfo.syllables.forEach((syl) => {
                sylItems.push({
                  beatIndex: syl.beatIndex,
                  wordIndex,
                  sylIndex: syl.sylIndex,
                  reading: syl.reading,
                  timeMs: syl.timeMs,
                  isSet: syl.isSet,
                  isSelected: syl.isSelected,
                  isHighlighted: syl.isHighlighted,
                  isSpace: false,
                  isNewline: false,
                  label: syl.reading,
                });
              });
            }
          });

        return (
          <div key={li} style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 'var(--space-xs)', alignItems: 'flex-end' }}>
            {sylItems.map((item, si) => {
              const timeText = item.isSet && item.timeMs != null
                ? formatTime({ msec: Math.round(item.timeMs) }, '.', false, false)
                : '0:00.000';
              // Estimate time text width for card min-width (mono 10px ≈ 6px/char)
              const timeWidth = timeText.length * 6 + 2;
              const cardCls = [
                'wc-card',
                item.isSet && !item.isHighlighted && !item.isSelected ? 'tv-syl-set' : '',
                item.isHighlighted && !item.isSelected ? 'tv-syl-highlighted' : '',
                item.isSelected ? 'tv-syl-selected' : '',
              ].filter(Boolean).join(' ');
              const indicatorCls = [
                'tv-tri-cell',
                item.isSet && !item.isSelected ? 'tv-tri-set' : '',
                !item.isSet && !item.isSelected ? 'tv-tri-unset' : '',
                item.isSelected ? 'tv-tri-cursor' : '',
              ].filter(Boolean).join(' ');
              const dotCls = [
                'tv-dot-cell',
                item.isSet && !item.isSelected ? 'tv-dot-set' : '',
                !item.isSet && !item.isSelected ? 'tv-dot-unset' : '',
                item.isSelected ? 'tv-dot-cursor' : '',
              ].filter(Boolean).join(' ');

              const isSep = item.isSpace || item.isNewline;
              const handleBeatClick = () => { if (item.beatIndex >= 0) onSelectBeat?.(item.beatIndex); };

              const isEditing = editingBeatIndex !== null && (
                (item.beatIndex >= 0 && editingBeatIndex === item.beatIndex) ||
                (item.beatIndex === -1 && editingBeatIndex === -1 && item.wordIndex === editingWordIndex)
              );
              const handleDblClick = () => {
                if (item.beatIndex >= 0) onDoubleClickTime?.(item.beatIndex);
                else if (item.isSpace || item.isNewline) onDoubleClickTime?.(-1, item.wordIndex);
              };
              return (
                <div key={si} className="tv-column" data-beat-index={item.beatIndex >= 0 ? item.beatIndex : undefined} style={isSep ? { justifyContent: 'flex-end' } : undefined}>
                  {/* Time as ruby */}
                  <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: item.isSet ? 'var(--body)' : 'var(--ash)', lineHeight: 1, whiteSpace: 'nowrap', marginBottom: '2px' }}>
                    {timeText}
                  </span>
                  {/* Card (or edit input) */}
                  <span onDoubleClick={handleDblClick} onClick={handleBeatClick} onContextMenu={(e) => { onCardContextMenu?.(e, item.beatIndex >= 0 ? item.beatIndex : -1, item.wordIndex); }} style={{ cursor: 'pointer' }}>
                    {isEditing ? (
                      <input ref={editTimeRef}
                        className="wc-edit-input"
                        value={editingTimeValue ?? ''}
                        onChange={(e) => onEditingTimeChange?.(e.target.value)}
                        onBlur={() => onFinishEditTime?.()}
                        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); else if (e.key === 'Escape') onEditingTimeChange?.(''); }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : isSep ? (
                      <WordCard reading={item.label} isSpace={item.isSpace} isNewline={item.isNewline} isSelected={false} cardClass={cardCls} style={{ minWidth: timeWidth }} />
                    ) : (
                      <span className="wc-wrapper">
                        <WordCard reading={item.label} isSpace={false} isNewline={false} isSelected={false} cardClass={cardCls} style={{ minWidth: timeWidth }} />
                      </span>
                    )}
                  </span>
                  {/* Indicator (triangle or dot) */}
                  <div style={{ height: '20px', display: 'flex', alignItems: 'center' }}>
                    {isSep ? (
                      <span className={dotCls} onClick={handleBeatClick} style={{ cursor: 'pointer' }} />
                    ) : (
                      <span className={indicatorCls} onClick={handleBeatClick} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
