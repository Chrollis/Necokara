/**
 * whisper/tokenizer.ts — Whisper BPE tokenizer (GPT-2 byte-level BPE).
 *
 * Used at runtime for:
 *   - encoding the furigana prompt (user lyrics) into token ids
 *   - computing the non-speech suppression token set
 *   - decoding model output tokens back to text
 *
 * Data source: models/whisper/tokenizer.json (HF BPE format) + vocab.json.
 */

export interface WhisperSpecialTokens {
  eot: number; // <|endoftext|>
  sot: number; // <|startoftranscript|>
  transcribe: number; // <|transcribe|>
  translate: number; // <|translate|>
  sotPrev: number; // <|startofprev|>
  sotLm: number; // <|startoflm|>
  noSpeech: number; // <|nospeech|>
  noTimestamps: number; // <|notimestamps|>
  timestampBegin: number; // <|0.00|>
  ja: number; // <|ja|>
}

/** GPT-2 bytes_to_unicode: maps a byte (0-255) to a printable unicode char. */
export function buildByteEncoder(): Map<number, string> {
  const bs: number[] = [];
  for (let i = 0x21; i <= 0x7e; i++) bs.push(i);
  for (let i = 0xa1; i <= 0xac; i++) bs.push(i);
  for (let i = 0xae; i <= 0xff; i++) bs.push(i);
  const cs: number[] = bs.slice();
  let n = 0;
  for (let b = 0; b < 256; b++) {
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + n);
      n += 1;
    }
  }
  const map = new Map<number, string>();
  for (let i = 0; i < bs.length; i++)
    map.set(bs[i], String.fromCodePoint(cs[i]));
  return map;
}

/** Inverse of bytes_to_unicode: unicode char -> byte. */
export function buildByteDecoder(
  byteEncoder: Map<number, string>,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const [b, ch] of byteEncoder) map.set(ch, b);
  return map;
}

// tokenizer.json model.pat_str (whisper/tiktoken). JS regex with `u` flag supports \p{L}/\p{N}.
const PAT_STR =
  /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;

/** utf8 encode a JS string to an array of byte values. */
function utf8Bytes(s: string): number[] {
  const buf = Buffer.from(s, 'utf8');
  return Array.from(buf);
}

export class WhisperTokenizer {
  private readonly vocab: Map<string, number>; // token str -> id (includes specials)
  private readonly idToTok: Map<number, string>;
  private readonly byteEncoder: Map<number, string>;
  private readonly byteDecoder: Map<string, number>;
  private readonly specialTokens: WhisperSpecialTokens;

  /**
   * @param vocabJson content of vocab.json (BPE ranks, id 0..50256-ish)
   * @param tokenizerJson parsed tokenizer.json (HF BPE model + added_tokens)
   */
  constructor(vocabJson: Record<string, number>, tokenizerJson: any) {
    this.vocab = new Map(Object.entries(vocabJson));
    // merge HF model.vocab (BPE ranks) on top; vocab.json is authoritative for BPE ranks
    const model = tokenizerJson?.model;
    if (model?.vocab) {
      for (const [t, id] of Object.entries<number>(model.vocab)) {
        if (!this.vocab.has(t)) this.vocab.set(t, id);
      }
    }
    // special tokens live in added_tokens (e.g. <|startoftranscript|>, <|ja|>, <|0.00|>)
    if (Array.isArray(tokenizerJson?.added_tokens)) {
      for (const a of tokenizerJson.added_tokens) {
        if (typeof a.id === 'number' && typeof a.content === 'string') {
          if (!this.vocab.has(a.content)) this.vocab.set(a.content, a.id);
        }
      }
    }
    this.idToTok = new Map();
    for (const [t, id] of this.vocab) this.idToTok.set(id, t);

    this.byteEncoder = buildByteEncoder();
    this.byteDecoder = buildByteDecoder(this.byteEncoder);

    const get = (name: string): number => {
      const id = this.vocab.get(name);
      if (id === undefined)
        throw new Error(`missing special token ${name} in vocab`);
      return id;
    };
    // onnx-community export omits <|nospeech|>; it sits right before <|notimestamps|>
    // in the official whisper vocab layout, so fall back to notimestamps - 1.
    const noTimestamps = get('<|notimestamps|>');
    const noSpeech = this.vocab.get('<|nospeech|>') ?? noTimestamps - 1;
    this.specialTokens = {
      eot: get('<|endoftext|>'),
      sot: get('<|startoftranscript|>'),
      transcribe: get('<|transcribe|>'),
      translate: get('<|translate|>'),
      sotPrev: get('<|startofprev|>'),
      sotLm: get('<|startoflm|>'),
      noSpeech,
      noTimestamps,
      timestampBegin: get('<|0.00|>'),
      ja: get('<|ja|>'),
    };
  }

  get specials(): WhisperSpecialTokens {
    return this.specialTokens;
  }

  /** sot_sequence for timestamp mode: [sot, lang, task]. */
  sotSequence(language: number, task: 'transcribe' | 'translate'): number[] {
    return [
      this.specialTokens.sot,
      language,
      task === 'transcribe'
        ? this.specialTokens.transcribe
        : this.specialTokens.translate,
    ];
  }

  /**
   * BPE-encode a text (only the pieces; special tokens in input are not handled —
   * callers pass plain furigana text). Returns token ids.
   */
  encode(text: string): number[] {
    const out: number[] = [];
    const pieces = text.match(PAT_STR) ?? [text];
    for (const piece of pieces) {
      const bytes = utf8Bytes(piece);
      // initial: one part per byte, represented as the bytes_to_unicode char string
      let parts = bytes.map((b) => this.byteEncoder.get(b) ?? '');
      // iterative BPE merge using vocab ranks of concatenated char strings
      while (parts.length > 1) {
        let minRank = Infinity;
        let minIdx = -1;
        for (let i = 0; i < parts.length - 1; i++) {
          const pair = parts[i] + parts[i + 1];
          const r = this.vocab.get(pair);
          if (r !== undefined && r < minRank) {
            minRank = r;
            minIdx = i;
          }
        }
        if (minRank === Infinity) break;
        parts[minIdx] = parts[minIdx] + parts[minIdx + 1];
        parts.splice(minIdx + 1, 1);
      }
      for (const p of parts) {
        const id = this.vocab.get(p);
        if (id !== undefined) out.push(id);
      }
    }
    return out;
  }

  /** space token id (used by SuppressBlank). */
  spaceToken(): number {
    const ids = this.encode(' ');
    return ids.length > 0 ? ids[0] : 220;
  }

  /**
   * Language tokens supported by this model (e.g. <|ja|>). Extracted from the
   * vocab range between <|startoftranscript|> and <|translate|>.
   */
  languageTokens(): Array<{ code: string; id: number }> {
    const out: Array<{ code: string; id: number }> = [];
    const lo = this.specialTokens.sot + 1;
    const hi = this.specialTokens.transcribe;
    for (const [t, id] of this.vocab) {
      const m = /^<\|([a-z]{2,3})\|>$/.exec(t);
      if (m && id >= lo && id < hi) out.push({ code: m[1], id });
    }
    out.sort((a, b) => a.id - b.id);
    return out;
  }

  /**
   * non_speech_tokens: tokens to suppress to avoid speaker tags / non-speech
   * annotations (reproduces whisper/tokenizer.py Tokenizer.non_speech_tokens).
   */
  nonSpeechTokens(): number[] {
    const symbols = '"#()*+/:;<=>@[\\]^_`{|}~「」『』'.split('');
    symbols.push(
      ...'<< >> <<< >>> -- --- -( -[ (\' (\" (( )) ((( ))) [[ ]] {{ }} ♪♪ ♪♪♪'.split(
        ' ',
      ),
    );
    const miscellaneous = new Set('♩♪♫♬♭♮♯'.split(''));
    const result = new Set<number>();
    for (const s of [' -', " '"]) {
      const ids = this.encode(s);
      if (ids.length > 0) result.add(ids[0]);
    }
    for (const symbol of [...symbols, ...miscellaneous]) {
      for (const s of [symbol, ` ${symbol}`]) {
        const ids = this.encode(s);
        if (ids.length === 1 || miscellaneous.has(symbol)) {
          if (ids.length > 0) result.add(ids[0]);
        }
      }
    }
    return Array.from(result).sort((a, b) => a - b);
  }

  /**
   * Decode token ids to text, skipping timestamp tokens (>= timestampBegin).
   * Uses the byte-level reverse table + utf8.
   */
  decode(tokenIds: number[]): string {
    const bytes: number[] = [];
    const tsBegin = this.specialTokens.timestampBegin;
    for (const id of tokenIds) {
      if (id >= tsBegin) continue;
      const t = this.idToTok.get(id);
      if (t === undefined) continue;
      for (const ch of t) {
        const b = this.byteDecoder.get(ch);
        bytes.push(b !== undefined ? b : (ch.codePointAt(0) ?? 0));
      }
    }
    return Buffer.from(bytes).toString('utf8');
  }

  /** id -> token string (for debugging / timestamp resolution). */
  tokenString(id: number): string | undefined {
    return this.idToTok.get(id);
  }
}
