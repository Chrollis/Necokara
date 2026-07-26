import {
  forwardRef,
  useState,
  useRef,
  useEffect,
  type ReactNode,
  type RefObject,
} from 'react';
import type { Lyrics } from '../../editor/lyrics';
import { isSpaceWord, isNewlineWord } from '../../editor/word';
import WordCard from '../../shared/components/WordCard';

interface CardsCanvasProps {
  lyrics: Lyrics;
  selectedIndices: number[];
  renderTick: number;
  editingTextIdx: number | null;
  editingTextValue: string;
  onSelect: (index: number, mod: boolean, shift: boolean) => void;
  onCanvasClick: () => void;
  onContextMenu: (x: number, y: number, wordIndex: number) => void;
  onDragSelect: (startIdx: number, endIdx: number) => void;
  onCanvasContext: (x: number, y: number) => void;
  onDoubleClick: (wordIndex: number) => void;
  onEditingTextChange: (value: string) => void;
  onEditingTextFinish: () => void;
  onEditingTab: () => void;
  editInputRef: RefObject<HTMLInputElement | null>;
}

const CardsCanvas = forwardRef<HTMLDivElement, CardsCanvasProps>(
  (
    {
      lyrics,
      selectedIndices,
      renderTick,
      editingTextIdx,
      editingTextValue,
      onSelect,
      onCanvasClick,
      onContextMenu,
      onDragSelect,
      onCanvasContext,
      onDoubleClick,
      onEditingTextChange,
      onEditingTextFinish,
      onEditingTab,
      editInputRef,
    },
    ref,
  ) => {
    const [isDragging, setIsDragging] = useState(false);
    const [dragFrom, setDragFrom] = useState(-1);
    const [dragRect, setDragRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
    const dragStartPos = useRef({ x: 0, y: 0 });
    const dragOccurred = useRef(false);
    const cardEls = useRef<Map<number, HTMLElement>>(new Map());

    const getWordIndexAt = (clientX: number, clientY: number): number => {
      let bestIdx = -1;
      let bestDist = Infinity;
      cardEls.current.forEach((el, idx) => {
        if (el.dataset.newline === 'true') return;
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const dist = Math.abs(clientX - cx);
        if (
          dist < bestDist &&
          clientY >= rect.top - 20 &&
          clientY <= rect.bottom + 20
        ) {
          bestDist = dist;
          bestIdx = idx;
        }
      });
      return bestIdx;
    };

    const handleMouseDown = (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest('.wc-card, .wc-edit-input, .wc-wrapper')) return;
      e.preventDefault();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      dragStartPos.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      setIsDragging(true);
      setDragFrom(getWordIndexAt(e.clientX, e.clientY));
    };

    useEffect(() => {
      if (!isDragging) return;
      const handleMove = (e: MouseEvent) => {
        const canvas = document.querySelector('.ed-canvas');
        if (!canvas) return;
        const crect = canvas.getBoundingClientRect();
        const cx = e.clientX - crect.left;
        const cy = e.clientY - crect.top;
        const dl = Math.min(dragStartPos.current.x, cx);
        const dt = Math.min(dragStartPos.current.y, cy);
        const dw = Math.abs(cx - dragStartPos.current.x);
        const dh = Math.abs(cy - dragStartPos.current.y);
        setDragRect({ x: dl, y: dt, w: dw, h: dh });

        const dragLeft = dl + crect.left;
        const dragTop = dt + crect.top;
        const dragRight = dragLeft + dw;
        const dragBottom = dragTop + dh;

        const found: number[] = [];
        cardEls.current.forEach((el, idx) => {
          if (el.dataset.newline === 'true') return;
          const r = el.getBoundingClientRect();
          if (r.left < dragRight && r.right > dragLeft && r.top < dragBottom && r.bottom > dragTop) {
            found.push(idx);
          }
        });
        if (found.length > 0) {
          dragOccurred.current = true;
          const min = Math.min(...found);
          const max = Math.max(...found);
          onDragSelect(min, max);
        }
      };
      const handleUp = () => {
        setIsDragging(false);
        setDragFrom(-1);
        setDragRect(null);
      };
      document.addEventListener('mousemove', handleMove);
      document.addEventListener('mouseup', handleUp);
      return () => {
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', handleUp);
      };
    }, [isDragging, dragFrom, onDragSelect]);

    const handleWordClick = (index: number, e: React.MouseEvent) => {
      e.stopPropagation();
      onSelect(index, e.ctrlKey || e.metaKey, e.shiftKey);
    };

    const handleWordContext = (index: number, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onContextMenu(e.clientX, e.clientY, index);
    };

    const handleCanvasContext = (e: React.MouseEvent) => {
      e.preventDefault();
      const target = e.target as HTMLElement;
      if (target.closest('.wc-card, .wc-edit-input, .wc-wrapper')) return;
      onCanvasContext(e.clientX, e.clientY);
    };

    const handleWordDoubleClick = (index: number, e: React.MouseEvent) => {
      e.stopPropagation();
      onDoubleClick(index);
    };

    const handleInputKeyDown = (e: React.KeyboardEvent) => {
      e.nativeEvent.stopImmediatePropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        onEditingTextFinish();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        onEditingTab();
      } else if (e.key === 'Escape') {
        onEditingTextFinish();
      } else if (e.key === ' ') {
        // Allow space in edit mode, just prevent document shortcuts
        e.nativeEvent.stopImmediatePropagation();
      }
    };

    const rows: ReactNode[] = [];
    let lineStart = 0;

    lyrics.words.forEach((word, wi) => {
      if (isNewlineWord(word)) {
        rows.push(
          <div className="ed-card-row" key={`row-${lineStart}`}>
            {renderRowWords(lyrics, lineStart, wi + 1)}
          </div>,
        );
        lineStart = wi + 1;
      }
    });

    if (lineStart < lyrics.words.length) {
      rows.push(
        <div className="ed-card-row" key={`row-${lineStart}`}>
          {renderRowWords(lyrics, lineStart, lyrics.words.length)}
        </div>,
      );
    }

    return (
      <div
        className="ed-canvas"
        ref={ref}
        onClick={(e) => {
          if (dragOccurred.current) {
            dragOccurred.current = false;
            return;
          }
          onCanvasClick();
        }}
        onMouseDown={handleMouseDown}
        onContextMenu={handleCanvasContext}
      >
        {rows}
        {dragRect && (
          <div
            className="ed-drag-rect"
            style={{
              left: dragRect.x,
              top: dragRect.y,
              width: dragRect.w,
              height: dragRect.h,
            }}
          />
        )}
      </div>
    );

    function registerCard(el: HTMLElement | null, idx: number, isNewline: boolean) {
      if (el) {
        el.dataset.newline = String(isNewline);
        cardEls.current.set(idx, el);
      } else {
        cardEls.current.delete(idx);
      }
    }

    function renderRowWords(lyrics: Lyrics, start: number, end: number) {
      const cards: ReactNode[] = [];

      for (let i = start; i < end; i += 1) {
        const word = lyrics.words[i];
        const isSelected = selectedIndices.includes(i);
        const isEditing = editingTextIdx === i;

        cards.push(
          <span
            key={i}
            ref={(el) => registerCard(el as HTMLElement | null, i, isNewlineWord(word))}
            className={word.withRuby ? 'wc-wrapper' : undefined}
            onClick={(e) => handleWordClick(i, e)}
            onDoubleClick={(e) => handleWordDoubleClick(i, e)}
            onContextMenu={(e) => handleWordContext(i, e)}
          >
            {word.withRuby && (
              <span className="wc-ruby-above">
                {word.syllables.map((s) => s.reading).join('')}
              </span>
            )}
            {isEditing ? (
              <input
                ref={editInputRef}
                className="wc-edit-input"
                value={editingTextValue}
                onChange={(e) => onEditingTextChange(e.target.value)}
                onBlur={onEditingTextFinish}
                onKeyDown={handleInputKeyDown}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <WordCard
                reading={word.reading}
                isSpace={isSpaceWord(word)}
                isNewline={isNewlineWord(word)}
                isSelected={isSelected}
                style={word.withRuby ? { minWidth: word.syllables.map((s) => s.reading).join('').length * 6 + 6 } : undefined}
              />
            )}
          </span>,
        );
      }

      return cards;
    }
  },
);

CardsCanvas.displayName = 'CardsCanvas';

export default CardsCanvas;
