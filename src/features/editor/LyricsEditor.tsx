import { useState, useCallback, useRef, useEffect } from 'react';
import type { Lyrics } from '../../editor/lyrics';
import {
  isNewlineWord,
  isSpaceWord,
  isSeparatorWord,
  createUnsetWord,
  createWordWithSyllables,
  createSpaceWord,
  createNewlineWord,
} from '../../editor/word';
import { createSyllable, createUnsetSyllable } from '../../editor/syllable';
import type { Syllable } from '../../editor/syllable';
import { analyzeRuby } from '../../editor/japanese-tokenizer';
import CardsCanvas from './CardsCanvas';
import ContextMenu from './ContextMenu';
import EditorToolbar from './EditorToolbar';
import SelectionContextMenu from './SelectionContextMenu';
import RubyEditorModal from './RubyEditorModal';
import SplitModal from './SplitModal';
import BatchEditModal from './BatchEditModal';
import './editor.css';

interface LyricsEditorProps {
  lyrics: Lyrics;
  undoManager: {
    record: (lyrics: Lyrics) => void;
    undo: (lyrics: Lyrics) => boolean;
    redo: (lyrics: Lyrics) => boolean;
    canUndo: () => boolean;
    canRedo: () => boolean;
  };
  snack?: { show: (msg: string, durationMs?: number) => void };
  onLyricsChange?: () => void;
}

export default function LyricsEditor({ lyrics, undoManager, snack, onLyricsChange }: LyricsEditorProps) {
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    wordIndex: number;
  } | null>(null);
  const [selCtxMenu, setSelCtxMenu] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [segmentMenuOpen, setSegmentMenuOpen] = useState(false);
  const [batchEditOpen, setBatchEditOpen] = useState(false);
  const [rubyEditorWordIdx, setRubyEditorWordIdx] = useState<number | null>(
    null,
  );
  const [splitWordIdx, setSplitWordIdx] = useState<number | null>(null);
  const [editingTextIdx, setEditingTextIdx] = useState<number | null>(null);
  const [editingTextValue, setEditingTextValue] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Record initial state so first edit has something to undo to
  useEffect(() => {
    undoManager.record(lyrics);
    // mount-only
  }, []);

  function mergeConsecutiveSeparators() {
    const ws = lyrics.words;
    let i = 1;
    while (i < ws.length) {
      if (isSeparatorWord(ws[i]) && isSeparatorWord(ws[i - 1])) {
        if (isNewlineWord(ws[i]) || isNewlineWord(ws[i - 1])) {
          ws.splice(i - 1, 1);
          if (i > 1) i -= 1;
        } else {
          ws.splice(i, 1);
        }
      } else {
        i += 1;
      }
    }
  }

  function ensureTrailingNewline() {
    const ws = lyrics.words;
    if (ws.length === 0 || !isNewlineWord(ws[ws.length - 1])) {
      ws.push(createNewlineWord());
    }
  }

  const forceRender = useCallback(() => {
    mergeConsecutiveSeparators();
    ensureTrailingNewline();
    onLyricsChange?.();
  }, [lyrics, onLyricsChange]);

  const handleSelect = useCallback(
    (index: number, mod: boolean, shift: boolean) => {
      if (shift && selectedIndices.length > 0) {
        const last = selectedIndices[selectedIndices.length - 1];
        const min = Math.min(last, index);
        const max = Math.max(last, index);
        const range: number[] = [];
        for (let i = min; i <= max; i += 1) {
          range.push(i);
        }
        setSelectedIndices(range);
      } else if (mod) {
        setSelectedIndices((prev) =>
          prev.includes(index)
            ? prev.filter((i) => i !== index)
            : [...prev, index],
        );
      } else {
        setSelectedIndices([index]);
      }
      setContextMenu(null);
    },
    [lyrics, selectedIndices],
  );

  const handleCanvasClick = useCallback(() => {
    setSelectedIndices([]);
    setContextMenu(null);
    setEditingTextIdx(null);
  }, []);

  const handleContextMenu = useCallback(
    (x: number, y: number, wordIndex: number) => {
      setContextMenu({ x, y, wordIndex });
    },
    [],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleDragSelect = useCallback((startIdx: number, endIdx: number) => {
    const range: number[] = [];
    for (let i = startIdx; i <= endIdx; i += 1) {
      range.push(i);
    }
    setSelectedIndices(range);
  }, []);

  const handleCanvasContext = useCallback(
    (x: number, y: number) => {
      setSelCtxMenu({ x, y });
    },
    [],
  );

  const handleBatchEditOpen = useCallback(() => {
    setBatchEditOpen(true);
    setSelCtxMenu(null);
  }, []);

  const handleBatchEditSave = useCallback(
    (edits: Array<{ index: number; text: string }>) => {
      edits.forEach((e) => {
        const cleaned = e.text.replace(/\s/g, '');
        if (cleaned.length > 0) {
          lyrics.words[e.index] = createUnsetWord(cleaned);
        }
      });
      setBatchEditOpen(false);
      forceRender();
      undoManager.record(lyrics);
    },
    [lyrics, undoManager, forceRender],
  );

  const handleCharSegmentation = useCallback(() => {
    const sorted = [...selectedIndices].sort((a, b) => b - a);
    sorted.forEach((idx) => {
      const word = lyrics.words[idx];
      if (isSeparatorWord(word)) return;
      const chars = [...word.reading];
      if (chars.length < 2) return;
      const newWords = chars.map((ch, ci) => {
        if (ci === 0) {
          const newSyllables = word.syllables.map((s) =>
            s.isSet
              ? createSyllable(s.reading, { msec: s.time.msec })
              : createUnsetSyllable(s.reading)
          );
          return createWordWithSyllables(ch, newSyllables, word.withRuby, word.isReadingAutoGenerated);
        }
        return createUnsetWord(ch);
      });
      lyrics.words.splice(idx, 1, ...newWords);
    });
    forceRender();
    undoManager.record(lyrics);
  }, [lyrics, selectedIndices, undoManager, forceRender]);

  const handleMerge = useCallback(() => {
    if (selectedIndices.length < 2) return;
    const sorted = [...selectedIndices].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i] - sorted[i - 1] !== 1) { snack?.show('只能合并连续的词'); return; }
    }
    const first = sorted[0];
    const words = sorted.map((i) => lyrics.words[i]);
    const mergedReading = words.filter((w) => !isSeparatorWord(w)).map((w) => w.reading).join('');
    const mergedSyllables: Syllable[] = [];
    words.forEach((w) => {
      if (!isSeparatorWord(w)) w.syllables.forEach((s) => mergedSyllables.push(s));
    });
    const hasRuby = words.some((w) => w.withRuby);
    // if first word is a separator, replace it; otherwise merge into first
    if (isSeparatorWord(lyrics.words[first])) {
      const newWord = mergedReading
        ? createWordWithSyllables(mergedReading, mergedSyllables, hasRuby, false)
        : createSpaceWord();
      lyrics.words[first] = newWord;
    } else {
      lyrics.words[first] = createWordWithSyllables(mergedReading, mergedSyllables, hasRuby, false);
    }
    for (let i = sorted.length - 1; i > 0; i -= 1) {
      lyrics.words.splice(sorted[i], 1);
    }
    setSelectedIndices([first]);
    forceRender();
    undoManager.record(lyrics);
  }, [lyrics, selectedIndices, undoManager, forceRender, snack]);

  const handleBatchDelete = useCallback(() => {
    const sorted = [...selectedIndices].sort((a, b) => b - a);
    sorted.forEach((i) => {
      lyrics.words.splice(i, 1);
    });
    setSelectedIndices([]);
    setSelCtxMenu(null);
    forceRender();
    undoManager.record(lyrics);
  }, [lyrics, selectedIndices, undoManager, forceRender]);

  const handleDelete = useCallback(
    (wordIndex: number) => {
      lyrics.words.splice(wordIndex, 1);
      setSelectedIndices([]);
      forceRender();
      undoManager.record(lyrics);
    },
    [lyrics, undoManager, forceRender],
  );

  const handleSplit = useCallback((wordIndex: number) => {
    const word = lyrics.words[wordIndex];
    if (word.syllables.length !== 1 || !word.isReadingAutoGenerated) return;
    setSplitWordIdx(wordIndex);
  }, []);

  const handleSplitSave = useCallback(
    (wordIndex: number, leftText: string, rightText: string) => {
      lyrics.words.splice(wordIndex, 1);
      lyrics.words.splice(wordIndex, 0, createUnsetWord(leftText), createUnsetWord(rightText));
      setSelectedIndices([]);
      forceRender();
      undoManager.record(lyrics);
    },
    [lyrics, undoManager, forceRender],
  );

  const handleEditRuby = useCallback((wordIndex: number) => {
    setRubyEditorWordIdx(wordIndex);
  }, []);

  const handleRubySave = useCallback(
    (wordIndex: number, syllables: Array<{ reading: string }>) => {
      const word = lyrics.words[wordIndex];
      const oldLen = word.syllables.length;
      for (let i = 0; i < syllables.length; i += 1) {
        if (i < oldLen) {
          word.syllables[i].reading = syllables[i].reading;
        } else {
          word.syllables.push({ reading: syllables[i].reading, isSet: false, time: { msec: 0 } });
        }
      }
      while (word.syllables.length > syllables.length) {
        word.syllables.pop();
      }
      word.withRuby = true;
      word.isReadingAutoGenerated = false;
      forceRender();
      undoManager.record(lyrics);
    },
    [lyrics, forceRender],
  );

  const handleRubyResetDefault = useCallback(
    (wordIndex: number) => {
      const word = lyrics.words[wordIndex];
      word.syllables.length = 1;
      word.syllables[0] = { reading: word.reading, isSet: false, time: { msec: 0 } };
      word.withRuby = false;
      word.isReadingAutoGenerated = true;
      forceRender();
      undoManager.record(lyrics);
    },
    [lyrics, forceRender],
  );

  const handleEditText = useCallback((wordIndex: number) => {
    const word = lyrics.words[wordIndex];
    setEditingTextIdx(wordIndex);
    setEditingTextValue(word.reading);
    setTimeout(() => editInputRef.current?.focus(), 0);
  }, []);

  const handleFinishEditText = useCallback(() => {
    if (editingTextIdx === null) return;
    const raw = editingTextValue;
    const word = lyrics.words[editingTextIdx];
    // Preserve original ruby/syllable info when only the surface text changes
    if (!raw.includes('\n') && raw.trim().length > 0) {
      const cleaned = raw.replace(/\s/g, '');
      if (cleaned.length > 0) {
        const preservedSyllables = word.syllables.length > 0
          ? word.syllables
          : [createUnsetSyllable(cleaned)];
        lyrics.words[editingTextIdx] = createWordWithSyllables(
          cleaned,
          preservedSyllables,
          word.withRuby,
          word.isReadingAutoGenerated,
        );
        setEditingTextIdx(null);
        forceRender();
        undoManager.record(lyrics);
        return;
      }
    }
    // Newline, space, or empty — replace entirely
    if (raw.includes('\n')) {
      lyrics.words[editingTextIdx] = createNewlineWord();
    } else if (raw.trim().length === 0) {
      lyrics.words[editingTextIdx] = createSpaceWord();
    }
    setEditingTextIdx(null);
    forceRender();
    undoManager.record(lyrics);
  }, [editingTextIdx, editingTextValue, lyrics, forceRender, undoManager]);

  const handleEditingTab = useCallback(() => {
    const curIdx = editingTextIdx;
    handleFinishEditText();
    if (curIdx !== null) {
      const insertAt = curIdx + 1;
      lyrics.words.splice(insertAt, 0, createSpaceWord());
      setEditingTextIdx(insertAt);
      setEditingTextValue('');
      undoManager.record(lyrics);
      setTimeout(() => editInputRef.current?.focus(), 0);
    }
  }, [editingTextIdx, handleFinishEditText, undoManager, lyrics]);

  const handleInsertBefore = useCallback(
    (wordIndex: number) => {
      lyrics.words.splice(wordIndex, 0, createSpaceWord());
      forceRender();
      undoManager.record(lyrics);
    },
    [lyrics, undoManager, forceRender],
  );

  const handleInsertAfter = useCallback(
    (wordIndex: number) => {
      lyrics.words.splice(wordIndex + 1, 0, createSpaceWord());
      forceRender();
      undoManager.record(lyrics);
    },
    [lyrics, undoManager, forceRender],
  );

  const handleInsertNewline = useCallback(
    (wordIndex: number) => {
      lyrics.words.splice(wordIndex + 1, 0, createNewlineWord());
      forceRender();
      undoManager.record(lyrics);
    },
    [lyrics, undoManager, forceRender],
  );

  const handleConvertToSpace = useCallback(
    (wordIndex: number) => {
      lyrics.words[wordIndex] = createSpaceWord();
      forceRender();
      undoManager.record(lyrics);
    },
    [lyrics, undoManager, forceRender],
  );

  const handleConvertToNewline = useCallback(
    (wordIndex: number) => {
      lyrics.words[wordIndex] = createNewlineWord();
      forceRender();
      undoManager.record(lyrics);
    },
    [lyrics, undoManager, forceRender],
  );

  const handleImport = useCallback(
    (imported: Lyrics) => {
      lyrics.words.length = 0;
      imported.words.forEach((w) => lyrics.words.push(w));
      setSelectedIndices([]);
      forceRender();
      undoManager.record(lyrics);
    },
    [lyrics, forceRender],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (editingTextIdx !== null) return;
      const idx = selectedIndices[0];
      if (idx === undefined || idx >= lyrics.words.length) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!isNewlineWord(lyrics.words[idx])) {
          handleDelete(idx);
        }
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        lyrics.words.splice(idx + 1, 0, createNewlineWord());
        setSelectedIndices([idx + 1]);
        forceRender();
        undoManager.record(lyrics);
      } else if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        lyrics.words.splice(idx, 0, createNewlineWord());
        setSelectedIndices([idx]);
        forceRender();
        undoManager.record(lyrics);
      } else if (e.key === ' ' && !e.shiftKey) {
        e.preventDefault();
        lyrics.words.splice(idx + 1, 0, createSpaceWord());
        setSelectedIndices([idx + 1]);
        forceRender();
        undoManager.record(lyrics);
      } else if (e.key === ' ' && e.shiftKey) {
        e.preventDefault();
        lyrics.words.splice(idx, 0, createSpaceWord());
        setSelectedIndices([idx]);
        forceRender();
        undoManager.record(lyrics);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [selectedIndices, lyrics, handleDelete, undoManager, forceRender, editingTextIdx]);

  useEffect(() => {
    if (!selCtxMenu && !segmentMenuOpen) return undefined;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (selCtxMenu && !target.closest('.ed-context-menu')) {
        setSelCtxMenu(null);
      }
      if (segmentMenuOpen && !target.closest('.ed-seg-root')) {
        setSegmentMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
    };
  }, [selCtxMenu, segmentMenuOpen]);

  const handleSegment = useCallback(async (withRuby: boolean) => {
    const sorted = [...selectedIndices].sort((a, b) => b - a);
    snack?.show('分词功能加载中…', 0); // 0 = 不自动消失
    try {
      for (const idx of sorted) {
        const word = lyrics.words[idx];
        if (isSeparatorWord(word)) continue;
        const result = await analyzeRuby(word.reading);
        if (!result || result.length === 0) continue;
        // withRuby=true 时即使只有1个单元也要应用注音
        if (!withRuby && result.length < 2) continue;
        const newWords = result.map((r) => {
          if (withRuby && r.readings.length > 0) {
            const syllables = r.readings.map((reading) => createUnsetSyllable(reading));
            return createWordWithSyllables(r.surface, syllables, true, false);
          }
          return createWordWithSyllables(r.surface, [createUnsetSyllable(r.surface)], false, false);
        });
        lyrics.words.splice(idx, 1, ...newWords);
      }
      forceRender();
      undoManager.record(lyrics);
      snack?.show(withRuby ? '分词注音完成' : '分词完成');
    } catch (err) {
      snack?.show(withRuby ? '日语分词注音失败' : '日语分词失败');
      console.error(err);
    }
  }, [lyrics, selectedIndices, undoManager, forceRender, snack]);

  return (
    <div className="editor">
      <EditorToolbar
        lyrics={lyrics}
        selectedCount={selectedIndices.length}
        segmentMenuOpen={segmentMenuOpen}
        onToggleSegmentMenu={() => setSegmentMenuOpen(!segmentMenuOpen)}
        onEdit={handleBatchEditOpen}
        onMerge={handleMerge}
        onDelete={handleBatchDelete}
        onCharSegment={handleCharSegmentation}
        onJpSegment={handleSegment}
        onImport={handleImport}
      />

      <CardsCanvas
        ref={canvasRef}
        lyrics={lyrics}
        selectedIndices={selectedIndices}
        onSelect={handleSelect}
        onCanvasClick={handleCanvasClick}
        onContextMenu={handleContextMenu}
        onDragSelect={handleDragSelect}
        onCanvasContext={handleCanvasContext}
        onDoubleClick={handleEditText}
        editingTextIdx={editingTextIdx}
        editingTextValue={editingTextValue}
        onEditingTextChange={setEditingTextValue}
        onEditingTextFinish={handleFinishEditText}
        onEditingTab={handleEditingTab}
        editInputRef={editInputRef}
        renderTick={0}
      />

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          wordIndex={contextMenu.wordIndex}
          lyrics={lyrics}
          onClose={closeContextMenu}
          onEditRuby={handleEditRuby}
          onEditText={handleEditText}
          onSplit={handleSplit}
          onDelete={handleDelete}
          onInsertBefore={handleInsertBefore}
          onInsertAfter={handleInsertAfter}
          onInsertSpace={handleInsertAfter}
          onInsertNewline={handleInsertNewline}
          onConvertToSpace={handleConvertToSpace}
          onConvertToNewline={handleConvertToNewline}
        />
      )}

      {selCtxMenu && (
        <SelectionContextMenu
          x={selCtxMenu.x}
          y={selCtxMenu.y}
          canUndo={undoManager.canUndo()}
          canRedo={undoManager.canRedo()}
          hasSelection={selectedIndices.length > 0}
          hasMultipleSelection={selectedIndices.length >= 2}
          onClose={() => setSelCtxMenu(null)}
          onUndo={() => { undoManager.undo(lyrics); forceRender(); }}
          onRedo={() => { undoManager.redo(lyrics); forceRender(); }}
          onEditSelection={handleBatchEditOpen}
          onDeleteSelection={handleBatchDelete}
          onMergeSelection={() => { handleMerge(); }}
          onSegment={() => setSegmentMenuOpen(true)}
        />
      )}

      {rubyEditorWordIdx !== null && (
        <RubyEditorModal
          word={lyrics.words[rubyEditorWordIdx]}
          wordIndex={rubyEditorWordIdx}
          onSave={handleRubySave}
          onResetDefault={handleRubyResetDefault}
          onClose={() => setRubyEditorWordIdx(null)}
        />
      )}

      {splitWordIdx !== null && (
        <SplitModal
          word={lyrics.words[splitWordIdx]}
          wordIndex={splitWordIdx}
          onSave={handleSplitSave}
          onClose={() => setSplitWordIdx(null)}
          snack={snack}
        />
      )}

      {batchEditOpen && (
        <BatchEditModal
          words={selectedIndices
            .filter((i) => !isNewlineWord(lyrics.words[i]))
            .map((i) => ({ index: i, word: lyrics.words[i] }))}
          onSave={handleBatchEditSave}
          onClose={() => setBatchEditOpen(false)}
        />
      )}

      <div className="ed-bottom">
        <span>
          {lyrics.wordCount()} words · {lyrics.nonSeparatorSyllableCount()} beats
        </span>
      </div>
    </div>
  );
}
