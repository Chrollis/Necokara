import type { Word } from './word';
import { Lyrics } from './lyrics';
import { createNewlineWord, isSeparatorWord } from './word';
import { createTime, formatTime, parseTime } from './time';
import { parseTextToWords, trimWhitespace } from './txtlyrics';

interface TimedLine {
  text: string;
  timeMs: number;
}

export function toLrc(lyrics: Lyrics): string {
  const fragments: string[] = [];

  const metaOrder: Array<{ key: string; lrcKey: string }> = [
    { key: 'title', lrcKey: 'ti' },
    { key: 'artist', lrcKey: 'ar' },
    { key: 'album', lrcKey: 'al' },
    { key: 'lyricist', lrcKey: 'au' },
    { key: 'timer', lrcKey: 'by' },
  ];

  metaOrder.forEach(({ key, lrcKey }) => {
    const value = lyrics.metadata[key];
    if (value && value.length > 0) {
      fragments.push(`[${lrcKey}:${value}]\n`);
    }
  });

  if (lyrics.metadata.offset && lyrics.metadata.offset.length > 0) {
    fragments.push(`[offset:${lyrics.metadata.offset}]\n`);
  }

  const standardKeys = new Set([
    'title',
    'artist',
    'album',
    'lyricist',
    'timer',
    'offset',
  ]);
  Object.entries(lyrics.metadata).forEach(([key, value]) => {
    if (!standardKeys.has(key) && value && value.length > 0) {
      fragments.push(`[${key}:${value}]\n`);
    }
  });

  let currentLineWords: Word[] = [];

  lyrics.words.forEach((word) => {
    if (word.reading !== '\n') {
      currentLineWords.push(word);
      return;
    }
    if (currentLineWords.length > 0) {
      const lineText = currentLineWords
        .map((w) => {
          if (w.reading === ' ') return ' ';
          if (w.reading === '\n') return '';
          return w.reading;
        })
        .join('');
      if (lineText.length > 0) {
        const firstWord = currentLineWords.find((w) => !isSeparatorWord(w));
        const timeMs = firstWord ? firstWord.syllables[0].time.msec : 0;
        const timeStr = formatTime(createTime(timeMs), '.', true, true);
        fragments.push(`${timeStr}${lineText}\n`);
      }
      currentLineWords = [];
    }
  });

  return fragments.join('');
}

export function fromLrc(text: string): Lyrics {
  const rawLines = text.split('\n');
  const metadata: Record<string, string> = {};
  const timedLines: TimedLine[] = [];

  rawLines.forEach((rawLine) => {
    const line = rawLine.replace(/\r$/, '');
    if (line.length === 0) return;

    let pos = 0;
    let pendingText = '';
    let pendingTimeMs = 0;
    let hasTime = false;

    const flushTimedLine = () => {
      const trimmed = trimWhitespace(pendingText);
      if (hasTime && trimmed.length > 0) {
        timedLines.push({ text: trimmed, timeMs: pendingTimeMs });
      }
      pendingText = '';
      hasTime = false;
    };

    while (pos < line.length) {
      const open = line.indexOf('[', pos);
      if (open === -1) {
        pendingText += line.substring(pos);
        break;
      }
      if (open > pos) {
        pendingText += line.substring(pos, open);
      }

      const close = line.indexOf(']', open);
      if (close === -1) {
        pendingText += line.substring(open);
        break;
      }

      const tagContent = line.substring(open + 1, close);
      pos = close + 1;

      if (tagContent === ':') {
        break;
      }

      const timeMatch = tagContent.match(
        /^([0-9]+):([0-9]+)(?:[,.:]([0-9]+))?$/,
      );
      if (timeMatch) {
        const timeStr = `[${tagContent}]`;
        const parsed = parseTime(timeStr);
        if (parsed.msec > 0 || parsed.msec === 0) {
          if (hasTime) {
            flushTimedLine();
          }
          pendingTimeMs = parsed.msec;
          hasTime = true;
        }
      } else {
        const colonIdx = tagContent.indexOf(':');
        if (colonIdx !== -1) {
          const key = tagContent.substring(0, colonIdx).toLowerCase();
          const value = tagContent.substring(colonIdx + 1).trim();
          if (key === 'ti') metadata.title = value;
          else if (key === 'ar') metadata.artist = value;
          else if (key === 'al') metadata.album = value;
          else if (key === 'au') metadata.lyricist = value;
          else if (key === 'by') metadata.timer = value;
          else if (key === 'offset') {
            metadata.offset = value;
          } else {
            metadata[key] = value;
          }
        }
      }
    }

    flushTimedLine();
  });

  timedLines.sort((a, b) => a.timeMs - b.timeMs);

  const words: Word[] = [];

  timedLines.forEach((current, i) => {
    const next = i + 1 < timedLines.length ? timedLines[i + 1] : null;
    const nextTimeMs = next ? next.timeMs : current.timeMs + 10000;

    const curMs = current.timeMs;
    const duration = Math.max(0, nextTimeMs - curMs);

    const lineWords = parseTextToWords(current.text);
    const filtered = lineWords.filter((w) => w.reading !== '\n');
    const textWords = filtered.filter((w) => w.reading !== ' ');
    const n = textWords.length;

    let cursor = curMs;

    if (n > 0) {
      const textTotal = Math.max(0, duration - n * 500);
      const perWord = Math.floor(textTotal / n);

      filtered.forEach((word) => {
        if (word.reading === ' ') {
          words.push(word);
          const idx = words.length - 1;
          words[idx].syllables[0].time = createTime(cursor);
          words[idx].syllables[0].isSet = true;
          cursor += 500;
        } else {
          words.push(word);
          const idx = words.length - 1;
          words[idx].syllables[0].time = createTime(cursor);
          words[idx].syllables[0].isSet = true;
          cursor += perWord;
        }
      });
    }

    const newlineWord = createNewlineWord();
    newlineWord.syllables[0].time = createTime(cursor);
    newlineWord.syllables[0].isSet = true;
    words.push(newlineWord);
  });

  if (words.length === 0 || words[words.length - 1].reading !== '\n') {
    words.push(createNewlineWord());
  }

  return new Lyrics(words, metadata);
}
