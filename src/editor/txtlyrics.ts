import type { Word } from './word';
import { Lyrics } from './lyrics';
import { createUnsetWord } from './word';

export function isBlank(char: string): boolean {
  return (
    char === ' ' ||
    char === '\t' ||
    char === '\n' ||
    char === '\r' ||
    char === '\u3000'
  );
}

export function trimWhitespace(str: string): string {
  return str.replace(/^[\s\u3000]+|[\s\u3000]+$/g, '');
}

export function containsNewline(str: string): boolean {
  return str.includes('\n');
}

export function normalizeWhitespace(raw: string): string {
  const trimmed = trimWhitespace(raw);
  if (trimmed.length === 0) {
    return containsNewline(raw) ? '\n' : ' ';
  }
  return trimmed;
}

export function parseTextToWords(text: string): Word[] {
  const words: Word[] = [];
  let pendingText = '';

  function flushPending(): void {
    if (pendingText.length === 0) return;
    const normalized = normalizeWhitespace(pendingText);
    if (normalized === ' ') {
      words.push(createUnsetWord(' '));
    } else if (normalized === '\n') {
      words.push(createUnsetWord('\n'));
    } else {
      words.push(createUnsetWord(normalized));
    }
    pendingText = '';
  }

  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (isBlank(char)) {
      flushPending();
      let blankRun = '';
      while (i < text.length && isBlank(text[i])) {
        blankRun += text[i];
        i += 1;
      }
      const normalized = normalizeWhitespace(blankRun);
      if (normalized === ' ') {
        words.push(createUnsetWord(' '));
      } else if (normalized === '\n') {
        words.push(createUnsetWord('\n'));
      }
    } else {
      pendingText += char;
      i += 1;
    }
  }

  flushPending();
  return words;
}

export function toTxt(lyrics: Lyrics): string {
  const parts: string[] = [];
  lyrics.words.forEach((word) => {
    if (word.reading === '\n') {
      parts.push('\n');
    } else if (word.reading === ' ') {
      parts.push(' ');
    } else {
      parts.push(word.reading);
    }
  });

  return parts.join('');
}

export function fromTxt(text: string): Lyrics {
  const words = parseTextToWords(text);

  const lastWord = words[words.length - 1];
  if (!lastWord || lastWord.reading !== '\n') {
    words.push(createUnsetWord('\n'));
  }

  return new Lyrics(words);
}
