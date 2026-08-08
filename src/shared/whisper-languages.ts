//
// whisper-languages.ts — auto-timing languages + token mapping
// Necokara auto-timing supports ja/zh/en only. Token ids follow
// openai/whisper: <|en|>=50259, <|zh|>=50260, <|ja|>=50266.
//

export const WHISPER_LANGUAGES = ['ja', 'zh', 'en'] as const;

export type WhisperLang = (typeof WHISPER_LANGUAGES)[number];

const LANG_ID: Record<WhisperLang, number> = {
  en: 50259,
  zh: 50260,
  ja: 50266,
};

const ID_TO_LANG: Record<number, WhisperLang> = {
  50259: 'en',
  50260: 'zh',
  50266: 'ja',
};

/** Language code for a whisper language token id. */
export function whisperLanguageCode(token: number): WhisperLang {
  return ID_TO_LANG[token] ?? 'ja';
}

/** Language token id for a code, or null if not supported. */
export function whisperLanguageId(code: string): number | null {
  return LANG_ID[code as WhisperLang] ?? null;
}

/** Chinese display name for a language code. */
export function whisperLangName(code: string): string {
  switch (code) {
    case 'ja':
      return '日语';
    case 'zh':
      return '中文';
    case 'en':
      return '英语';
    default:
      return code;
  }
}
