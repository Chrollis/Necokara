/**
 * Browser-compatible Japanese tokenizer using kuromoji.js.
 *
 * Mimics jumanlrc's analyzeRuby with mora (拍)-level splitting:
 *   - 拗音 (ゃ/ゅ/ょ) merges with previous char → one mora
 *   - 促音 (っ/ッ) → standalone mora
 *   - 長音 (ー) → standalone mora
 *   - Everything else → its own mora
 *
 * Replaces the Electron-native jumanlrc addon so the lyrics editor
 * works both in Electron and in a plain browser (webpack-dev-server).
 */

import kuromoji from 'kuromoji';
import type { Tokenizer, IpadicFeatures } from 'kuromoji';

// ─── Public types (matching jumanlrc's C++ API) ───────────────────

export interface WordResult {
  surface: string;
  reading: string;
}

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
 * Find the okurigana boundary: position after the last kanji character.
 * Returns surface.length if no kanji found.
 */
function okuriBoundary(surface: string): number {
  for (let i = surface.length - 1; i >= 0; i--) {
    if (isKanjiCp(surface.charCodeAt(i))) {
      return i + 1;
    }
  }
  return surface.length;
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
 * Word-level analysis: split sentence into surface+reading pairs.
 * Used by the "日语分词" (non-ruby) feature.
 */
export async function analyze(sentence: string): Promise<WordResult[] | null> {
  try {
    const tok = await ensureTokenizer();
    const tokens = tok.tokenize(sentence);
    return tokens.map((t) => ({
      surface: t.surface_form,
      reading: t.reading ?? t.surface_form,
    }));
  } catch (err) {
    console.error('[japanese-tokenizer] analyze error:', err);
    return null;
  }
}

/**
 * Ruby-ready analysis: split sentence into RubyUnits with mora-level readings.
 *
 * Rule: if the reading annotation equals the literal surface text, skip it.
 *
 * For each kuromoji token (word):
 *   1. If surface contains CJK kanji → kanji + okurigana split
 *      - Kanji part: surface kept as-is, reading split into mora for annotation
 *      - Okurigana: each kana char becomes its own RubyUnit (no readings)
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
        // ── Kanji word: split kanji + okurigana ──────────────
        const ob = okuriBoundary(surface);
        const kanjiPart = surface.slice(0, ob);
        const okuriPart = surface.slice(ob);

        // Convert reading (katakana) → hiragana for annotation
        const hiraReading = katakanaToHiragana(rawReading);
        const allMora = splitIntoMora(hiraReading);

        // Estimate mora count for okurigana
        let okuriMoraCount = 0;
        for (let i = 0; i < okuriPart.length; i++) {
          okuriMoraCount += 1;
        }
        // Clamp
        const totalMora = allMora.length;
        const nk = okuriMoraCount < totalMora ? okuriMoraCount : 0;
        const kanjiMoraCount = totalMora - nk;

        // Kanji unit with its portion of reading
        const ku: RubyUnit = { surface: kanjiPart, readings: [] };
        for (let i = 0; i < kanjiMoraCount && i < totalMora; i++) {
          ku.readings.push(allMora[i]);
        }
        result.push(ku);

        // Okurigana: each mora as its own unit (no readings needed)
        for (let i = kanjiMoraCount; i < totalMora; i++) {
          result.push({ surface: allMora[i], readings: [] });
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
