/**
 * Browser-compatible Japanese tokenizer using kuromoji.js.
 *
 * Splits into mora (拍)-level units:
 *   - 拗音 (ゃ/ゅ/ょ) merges with previous char → one mora
 *   - 促音 (っ/ッ) → standalone mora
 *   - 長音 (ー) → standalone mora
 *   - Everything else → its own mora
 */

import kuromoji from 'kuromoji';
import type { Tokenizer, IpadicFeatures } from 'kuromoji';

// ─── Public types ─────────────────────────────────────────────────

export interface RubyUnit {
  surface: string;
  readings: string[]; // empty if surface === reading (pure kana, no annotation needed)
}

// ─── Internal helpers ─────────────────────────────────────────────

function isKanjiCp(cp: number): boolean {
  return (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf);
}

function hasKanji(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (isKanjiCp(s.charCodeAt(i))) return true;
  }
  return false;
}

function isSmallYoon(ch: string): boolean {
  const cp = ch.charCodeAt(0);
  // ゃ U+3083, ゅ U+3085, ょ U+3087
  // ャ U+30E3, ュ U+30E5, ョ U+30E7
  return (
    cp === 0x3083 ||
    cp === 0x3085 ||
    cp === 0x3087 ||
    cp === 0x30e3 ||
    cp === 0x30e5 ||
    cp === 0x30e7
  );
}

/**
 * Check if a Unicode codepoint is hiragana or katakana,
 * excluding ヶ(U+30F6) and ヵ(U+30F5) which are treated as kanji.
 */
function isKanaCp(cp: number): boolean {
  if (cp === 0x30f5 || cp === 0x30f6) return false; // ヵ, ヶ → treat as kanji
  return (cp >= 0x3040 && cp <= 0x309f) || (cp >= 0x30a0 && cp <= 0x30ff);
}

/**
 * Split a kana string into mora (拍) units.
 *
 * Rules:
 *   1. 拗音 (small ゃ/ゅ/ょ) → merge with previous char (one mora)
 *   2. 促音 (っ/ッ) → standalone mora
 *   3. 長音 (ー) → standalone mora
 *   4. Everything else → its own mora
 */
function splitIntoMora(kana: string): string[] {
  const mora: string[] = [];
  let i = 0;
  while (i < kana.length) {
    // Small yoon merges with previous mora
    if (isSmallYoon(kana[i]) && mora.length > 0) {
      mora[mora.length - 1] += kana[i];
      i += 1;
      continue;
    }
    // Start a new mora
    mora.push(kana[i]);
    i += 1;
  }
  return mora;
}

/**
 * Split a mixed kanji-kana word (e.g. 思い出 → 思+い+出) into RubyUnits.
 *
 * Walks the surface left-to-right. On finding a kana character:
 *   - Everything before it (pure kanji) → one RubyUnit with its reading portion
 *   - The kana character itself → one RubyUnit (with reading if surface≠hiragana)
 *   - Find the kana in reading → split reading accordingly
 *   - Continue on remaining surface/reading
 *   - Pure-kanji tail → final RubyUnit
 *
 * ヶ/ヵ are treated as kanji (not kana infix).
 */
function splitMixedWord(surface: string, hiraReading: string): RubyUnit[] {
  const result: RubyUnit[] = [];
  let remSurf = surface;
  let remRead = hiraReading;

  while (remSurf.length > 0) {
    // Find first kana character in remaining surface
    let kanaIdx = -1;
    for (let i = 0; i < remSurf.length; i++) {
      if (isKanaCp(remSurf.charCodeAt(i))) {
        kanaIdx = i;
        break;
      }
    }

    // No more kana → pure kanji remainder
    if (kanaIdx === -1) {
      result.push({ surface: remSurf, readings: splitIntoMora(remRead) });
      break;
    }

    // Surface starts with kana → pure kana prefix, no splitting needed
    if (kanaIdx === 0) {
      const kanaChar = remSurf[0];
      const kanaHira = katakanaToHiragana(kanaChar);
      const unit: RubyUnit = { surface: kanaChar, readings: [] };
      if (kanaChar !== kanaHira) {
        unit.readings = splitIntoMora(kanaHira);
      }
      result.push(unit);
      remSurf = remSurf.slice(1);
      remRead = remRead.slice(1);
      continue;
    }

    // Kanji part before the kana character
    const kanjiSurf = remSurf.slice(0, kanaIdx);
    const kanaChar = remSurf[kanaIdx];

    // Find first occurrence of this kana in remaining reading
    const readIdx = remRead.indexOf(kanaChar);
    if (readIdx === -1) {
      // Not found in reading — skip this character, merge into surrounding kanji
      remSurf = remSurf.slice(0, kanaIdx) + remSurf.slice(kanaIdx + 1);
      continue;
    }

    // Kanji unit with its corresponding reading portion
    const kanjiReading = remRead.slice(0, readIdx);
    result.push({ surface: kanjiSurf, readings: splitIntoMora(kanjiReading) });

    // Kana character unit (with reading if surface ≠ hiragana)
    const kanaHira = katakanaToHiragana(kanaChar);
    const kanaUnit: RubyUnit = { surface: kanaChar, readings: [] };
    if (kanaChar !== kanaHira) {
      kanaUnit.readings = splitIntoMora(kanaHira);
    }
    result.push(kanaUnit);

    // Advance past this segment
    remSurf = remSurf.slice(kanaIdx + 1);
    remRead = remRead.slice(readIdx + 1);
  }

  return result;
}

function katakanaToHiragana(s: string): string {
  return s.replace(/[\u30A1-\u30F6]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60),
  );
}

// ─── Kuromoji setup ──────────────────────────────────────────────

let tokenizer: Tokenizer<IpadicFeatures> | null = null;
let initPromise: Promise<void> | null = null;

function resolveDicPath(): string {
  if (process.env.NODE_ENV === 'development') {
    return '/dict/';
  }
  return './dict/';
}

async function ensureTokenizer(): Promise<Tokenizer<IpadicFeatures>> {
  if (tokenizer) return tokenizer;
  if (initPromise) return initPromise.then(() => tokenizer!);

  initPromise = new Promise<void>((resolve, reject) => {
    kuromoji.builder({ dicPath: resolveDicPath() }).build((err, tok) => {
      if (err) {
        console.error('[japanese-tokenizer] Failed to load kuromoji:', err);
        reject(err);
        return;
      }
      tokenizer = tok;
      resolve();
    });
  });

  await initPromise;
  return tokenizer!;
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * Ruby-ready analysis: split sentence into RubyUnits with mora-level readings.
 *
 * Rule: if the reading annotation equals the literal surface text, skip it.
 *
 * For each kuromoji token (word):
 *   1. If surface contains CJK kanji → splitMixedWord (handles kanji+okurigana
 *      as well as mixed kanji-kana-kanji patterns like 思い出)
 *   2. If surface is pure kana:
 *      - Split surface and reading into mora
 *      - If same mora count: output each mora separately, only annotate when
 *        the hiragana reading differs from the surface mora
 *      - Otherwise: output as single unit (no readings)
 */
export async function analyzeRuby(
  sentence: string,
): Promise<RubyUnit[] | null> {
  try {
    const tok = await ensureTokenizer();
    const tokens = tok.tokenize(sentence);

    const result: RubyUnit[] = [];

    for (const t of tokens) {
      const surface = t.surface_form;
      const rawReading = t.reading ?? surface; // kuromoji returns katakana

      if (hasKanji(surface)) {
        // ── Kanji word: split mixed kanji-kana patterns ─────
        const hiraReading = katakanaToHiragana(rawReading);
        const units = splitMixedWord(surface, hiraReading);
        for (const u of units) {
          result.push(u);
        }
      } else {
        // ── Pure kana word ───────────────────────────────────
        const surfMora = splitIntoMora(surface);
        const readMora = splitIntoMora(rawReading);

        if (surfMora.length === readMora.length && surfMora.length > 1) {
          // Same mora count > 1: output each mora separately
          // Only annotate when hiragana reading differs from surface
          for (let i = 0; i < surfMora.length; i++) {
            const hira = katakanaToHiragana(readMora[i]);
            const u: RubyUnit = { surface: surfMora[i], readings: [] };
            if (surfMora[i] !== hira) {
              u.readings.push(hira);
            }
            result.push(u);
          }
        } else {
          // Single mora or mismatched counts: output as single unit
          const u: RubyUnit = { surface, readings: [] };
          const hira = katakanaToHiragana(rawReading);
          if (surface !== hira) {
            u.readings = splitIntoMora(hira);
          }
          result.push(u);
        }
      }
    }

    return result;
  } catch (err) {
    console.error('[japanese-tokenizer] analyzeRuby error:', err);
    return null;
  }
}
