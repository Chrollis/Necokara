import type { Word } from './word';
import type { Syllable } from './syllable';
import { Lyrics } from './lyrics';
import { createWord, createSpaceWord, createNewlineWord } from './word';
import { createTime, parseTime, formatTime } from './time';

interface RubyEntry {
  index: number;
  validStartMs: number;
  validEndMs: number;
  syllableTexts: string[];
  offsetMs: number[];
}

function parseRubyDef(line: string, idx: number): RubyEntry | null {
  const eqPos = line.indexOf('=');
  if (eqPos === -1) return null;

  const afterEq = line.substring(eqPos + 1);
  const parts: string[] = [];
  let start = 0;
  for (let pos = 0; pos <= afterEq.length; pos += 1) {
    if (pos === afterEq.length || afterEq[pos] === ',') {
      parts.push(afterEq.substring(start, pos).trim());
      start = pos + 1;
    }
  }

  if (parts.length < 2) return null;

  const entry: RubyEntry = {
    index: idx,
    validStartMs: 0,
    validEndMs: Number.MAX_SAFE_INTEGER,
    syllableTexts: [],
    offsetMs: [],
  };

  const voiceData = parts[1].trim();

  if (parts.length >= 3 && parts[2].trim().length > 0) {
    entry.validStartMs = parseTime(parts[2]).msec;
  }
  if (parts.length >= 4 && parts[3].trim().length > 0) {
    entry.validEndMs = parseTime(parts[3]).msec;
  }

  const voiceRe = /([^[]+)(?:\[(\d{1,2}:\d{1,2}:\d{1,3})\])?/g;
  let match: RegExpExecArray | null;
  let pos = 0;
  match = voiceRe.exec(voiceData);
  while (match !== null) {
    entry.syllableTexts.push(match[1]);
    entry.offsetMs.push(pos);
    if (match[2]) {
      pos = parseTime(match[2]).msec;
    }
    match = voiceRe.exec(voiceData);
  }

  if (entry.syllableTexts.length === 0) return null;
  return entry;
}

export function fromNicoLrc(text: string): Lyrics {
  const lines = text.split('\n');
  const metadata: Record<string, string> = {};
  const rubyMap: Map<string, RubyEntry[]> = new Map();

  interface WordEntry {
    time: number;
    text: string;
  }
  interface PendingLine {
    start: number;
    endTime: number;
    words: WordEntry[];
  }
  const pendingLines: PendingLine[] = [];

  let currentLineWords: WordEntry[] = [];
  let currentLineStart = 0;
  let currentLineEndTime = 0;
  let hasCurrentLine = false;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx += 1) {
    const rawLine = lines[lineIdx];
    const line = rawLine.replace(/\r$/, '');
    if (line.length === 0) continue;

    if (line[0] === '@') {
      if (hasCurrentLine) {
        pendingLines.push({
          start: currentLineStart,
          endTime: currentLineEndTime,
          words: currentLineWords,
        });
        currentLineWords = [];
        hasCurrentLine = false;
      }

      if (line.startsWith('@Title=')) {
        metadata.title = line.substring(7).trim();
      } else if (line.startsWith('@Artist=')) {
        metadata.artist = line.substring(8).trim();
      } else if (line.startsWith('@Album=')) {
        metadata.album = line.substring(7).trim();
      } else if (line.startsWith('@TaggingBy=')) {
        metadata.timer = line.substring(11).trim();
      } else if (line.startsWith('@SilenceMsec=')) {
        const val = line.substring(13).trim();
        const num = parseInt(val, 10);
        if (!Number.isNaN(num)) {
          metadata.offset = String(num);
        }
      } else if (line.startsWith('@Ruby') && line.includes('=')) {
        const eqPos = line.indexOf('=');
        const numStart = 5;
        const numEnd = eqPos;
        let idx = 0;
        try {
          idx = parseInt(line.substring(numStart, numEnd), 10);
        } catch {
          idx = 0;
        }
        const entry = parseRubyDef(line, idx);
        if (entry) {
          const afterEq = line.substring(eqPos + 1);
          const commaPos = afterEq.indexOf(',');
          const kanji =
            commaPos !== -1 ? afterEq.substring(0, commaPos).trim() : '';
          if (kanji) {
            if (!rubyMap.has(kanji)) {
              rubyMap.set(kanji, []);
            }
            rubyMap.get(kanji)!.push(entry);
          }
        }
      } else if (line.includes('=')) {
        const eqPos = line.indexOf('=');
        const key = line.substring(1, eqPos).trim().toLowerCase();
        const val = line.substring(eqPos + 1).trim();
        if (key) {
          metadata[key] = val;
        }
      }
      continue;
    }

    if (line[0] === '[') {
      if (hasCurrentLine) {
        pendingLines.push({
          start: currentLineStart,
          endTime: currentLineEndTime,
          words: currentLineWords,
        });
        currentLineWords = [];
        hasCurrentLine = false;
      }

      const lineRe = /\[(\d{1,2}:\d{1,2}:\d{1,3})\]([^[\]]*)/g;
      let match: RegExpExecArray | null;
      let firstTime = 0;
      let lastTime = 0;
      const lineWords: WordEntry[] = [];

      match = lineRe.exec(line);
      while (match !== null) {
        const timeMs = parseTime(match[1]).msec;
        const raw = match[2];
        if (firstTime === 0) firstTime = timeMs;
        lastTime = timeMs;
        if (raw.length === 0) {
          match = lineRe.exec(line);
          continue;
        }
        const cleaned = raw.replace(/[\s\u3000]/g, '');
        if (cleaned.length > 0) {
          lineWords.push({ time: timeMs, text: cleaned });
        } else if (raw.includes('\n')) {
          lineWords.push({ time: timeMs, text: '\n' });
        } else {
          lineWords.push({ time: timeMs, text: ' ' });
        }
        match = lineRe.exec(line);
      }

      if (lineWords.length > 0) {
        const endTime = lastTime > 0 ? lastTime : 0;
        lineWords.push({ time: endTime, text: '\n' });
        currentLineWords = lineWords;
        currentLineStart = firstTime;
        currentLineEndTime = endTime;
        hasCurrentLine = true;
      }
    }
  }

  if (hasCurrentLine) {
    pendingLines.push({
      start: currentLineStart,
      endTime: currentLineEndTime,
      words: currentLineWords,
    });
  }

  pendingLines.sort((a, b) => a.start - b.start);

  rubyMap.forEach((entries) => {
    entries.sort((a, b) => a.index - b.index);
  });

  const words: Word[] = [];

  pendingLines.forEach((line) => {
    line.words.forEach((entry) => {
      const { time: ms, text: wordText } = entry;

      if (wordText === '\n') {
        const nlWord = createNewlineWord();
        nlWord.syllables[0].time = createTime(ms);
        nlWord.syllables[0].isSet = true;
        words.push(nlWord);
        return;
      }

      if (wordText === ' ') {
        const spaceWord = createSpaceWord();
        spaceWord.syllables[0].time = createTime(ms);
        spaceWord.syllables[0].isSet = true;
        words.push(spaceWord);
        return;
      }

      const entries = rubyMap.get(wordText) || [];
      const validEntries = entries.filter((e) => e.validEndMs > ms);
      const matched = validEntries.find((e) => e.validStartMs <= ms);

      let word: Word;
      if (matched) {
        const syllables: Syllable[] = matched.syllableTexts.map(
          (sylText, idx) => {
            const offset = matched.offsetMs[idx] || 0;
            return {
              reading: sylText,
              time: createTime(ms + offset),
              isSet: true,
            };
          },
        );
        word = {
          reading: wordText,
          syllables,
          withRuby: true,
          isReadingAutoGenerated: false,
        };
      } else {
        word = createWord(wordText, createTime(ms));
        word.syllables[0].isSet = true;
        word.withRuby = false;
        word.isReadingAutoGenerated = true;
      }
      words.push(word);
    });
  });

  if (words.length === 0 || words[words.length - 1].reading !== '\n') {
    const nl = createNewlineWord();
    words.push(nl);
  }

  return new Lyrics(words, metadata);
}

export function toNicoLrc(lyrics: Lyrics): string {
  const result: string[] = [];

  lyrics.words.forEach((word) => {
    const time = word.syllables[0]?.time;
    if (!time) return;

    if (word.reading === '\n') {
      if (time.msec > 0) {
        result.push(formatTime(time, ':', true, true));
      }
      result.push('\n');
      return;
    }

    result.push(formatTime(time, ':', true, true));

    if (word.reading === ' ') {
      result.push(' ');
    } else {
      result.push(word.reading);
    }
  });

  if (result.length > 0 && !result[result.length - 1].endsWith('\n')) {
    result.push('\n');
  }

  result.push('\n');

  const metaMap: Array<[string, string]> = [
    ['@Title', lyrics.metadata.title],
    ['@Artist', lyrics.metadata.artist],
    ['@Album', lyrics.metadata.album],
    ['@TaggingBy', lyrics.metadata.timer],
  ];
  metaMap.forEach(([tag, value]) => {
    if (value && value.length > 0) {
      result.push(`${tag}=${value}\n`);
    }
  });

  if (lyrics.metadata.offset) {
    const offsetNum = parseInt(lyrics.metadata.offset, 10);
    if (!Number.isNaN(offsetNum) && offsetNum !== 0) {
      result.push(`@SilenceMsec=${offsetNum}\n`);
    }
  }

  const standardKeys = new Set([
    'title',
    'artist',
    'album',
    'timer',
    'offset',
    'lyricist',
  ]);
  Object.entries(lyrics.metadata).forEach(([key, value]) => {
    if (!standardKeys.has(key) && value && value.length > 0) {
      result.push(`@${key}=${value}\n`);
    }
  });

  interface SylInfo {
    texts: string[];
    offsets: number[];
  }

  function getSylInfo(word: Word): SylInfo {
    const base = word.syllables[0]?.time?.msec ?? 0;
    return {
      texts: word.syllables.map((s) => s.reading),
      offsets: word.syllables.map((s) => (s.time ? s.time.msec - base : 0)),
    };
  }

  function sameSyls(a: SylInfo, b: SylInfo): boolean {
    if (a.texts.length !== b.texts.length) return false;
    if (a.offsets.length !== b.offsets.length) return false;
    return (
      a.texts.every((t, i) => t === b.texts[i]) &&
      a.offsets.every((o, i) => o === b.offsets[i])
    );
  }

  const rubyWords = new Map<string, Word[]>();
  lyrics.words.forEach((word) => {
    if (word.reading === ' ' || word.reading === '\n') return;
    if (!word.withRuby) return;
    const time = word.syllables[0]?.time;
    if (!time) return;
    if (!rubyWords.has(word.reading)) rubyWords.set(word.reading, []);
    rubyWords.get(word.reading)!.push(word);
  });

  interface RubyOut {
    validStartMs: number;
    validEndMs: number;
    kanji: string;
    voice: string;
    first: boolean;
    last: boolean;
  }
  const allRuby: RubyOut[] = [];

  rubyWords.forEach((words, kanji) => {
    words.sort(
      (a, b) =>
        (a.syllables[0]?.time?.msec ?? 0) - (b.syllables[0]?.time?.msec ?? 0),
    );

    let groupStart = 0;
    let groupVoice = '';
    let lastInfo: SylInfo | null = null;
    let hasGroup = false;
    let entryCount = 0;

    words.forEach((word) => {
      const cur = getSylInfo(word);
      const ms = word.syllables[0]?.time?.msec ?? 0;

      if (hasGroup && lastInfo && sameSyls(lastInfo, cur)) return;

      if (hasGroup) {
        allRuby.push({
          validStartMs: groupStart,
          validEndMs: ms,
          kanji,
          voice: groupVoice,
          first: false,
          last: false,
        });
      }
      entryCount += 1;
      groupStart = ms;
      groupVoice = '';
      cur.texts.forEach((text, j) => {
        groupVoice += text;
        if (j + 1 < cur.texts.length) {
          const offsetTime = createTime(cur.offsets[j + 1]);
          groupVoice += formatTime(offsetTime, ':', true, true);
        }
      });
      lastInfo = cur;
      hasGroup = true;
    });

    if (hasGroup) {
      const firstIdx = allRuby.length - entryCount + 1;
      allRuby.push({
        validStartMs: groupStart,
        validEndMs: Number.MAX_SAFE_INTEGER,
        kanji,
        voice: groupVoice,
        first: false,
        last: false,
      });
      if (entryCount === 1) {
        allRuby[allRuby.length - 1].first = true;
        allRuby[allRuby.length - 1].last = true;
      } else {
        allRuby[firstIdx].first = true;
        allRuby[allRuby.length - 1].last = true;
      }
    }
  });

  allRuby.sort((a, b) => a.validStartMs - b.validStartMs);

  allRuby.forEach((r, i) => {
    if (r.first && r.last) {
      result.push(`@Ruby${i + 1}=${r.kanji},${r.voice}\n`);
    } else if (r.first) {
      result.push(
        `@Ruby${i + 1}=${r.kanji},${r.voice},,${formatTime(createTime(r.validEndMs), ':', true, true)}\n`,
      );
    } else if (r.last) {
      result.push(
        `@Ruby${i + 1}=${r.kanji},${r.voice},${formatTime(createTime(r.validStartMs), ':', true, true)}\n`,
      );
    } else {
      result.push(
        `@Ruby${i + 1}=${r.kanji},${r.voice},${formatTime(createTime(r.validStartMs), ':', true, true)},${formatTime(createTime(r.validEndMs), ':', true, true)}\n`,
      );
    }
  });

  return result.join('');
}
