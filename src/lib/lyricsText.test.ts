import { describe, expect, it } from "vitest";
import { detectLyricsLang } from "./lyricsText";

describe("detectLyricsLang", () => {
  it("returns undefined for Latin text and for empty input", () => {
    expect(detectLyricsLang(["Hello", "Hola, qué tal"])).toBeUndefined();
    expect(detectLyricsLang([])).toBeUndefined();
  });

  it("detects Japanese by kana, even when other lines are kanji or Latin", () => {
    expect(detectLyricsLang(["日本語", "こんにちは", "Hello"])).toBe("ja");
  });

  it("detects Korean by hangul", () => {
    expect(detectLyricsLang(["안녕하세요", "Hello"])).toBe("ko");
  });

  it("cannot tell kanji-only text from Chinese", () => {
    expect(detectLyricsLang(["日本語"])).toBeUndefined();
  });
});