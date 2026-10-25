export type LyricsLang = "ja" | "ko";

const KANA = /[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9f]/;
const HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/;

/**
 * Language hint for CJK lyrics, so Han characters shared by Japanese and Chinese are
 * drawn with the right glyph shapes. Kanji-only text cannot be told from Chinese: undefined.
 */
export function detectLyricsLang(texts: readonly string[]): LyricsLang | undefined {
  let ja = 0;
  let ko = 0;
  for (const text of texts) {
    if (KANA.test(text)) ja += 1;
    if (HANGUL.test(text)) ko += 1;
  }
  if (ja === 0 && ko === 0) return undefined;
  return ja >= ko ? "ja" : "ko";
}