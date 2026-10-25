import { describe, expect, it } from "vitest";
import type { LyricsLine } from "../ipc/types";
import { activeLineIndex, formatOffset, seekSecondsForLine } from "./lyricsSync";

const L = (ms: number, text = "x"): LyricsLine => ({ ms, text });

describe("activeLineIndex", () => {
  const lines = [L(1000), L(5000), L(9000), L(9000), L(20000)];

  it("is -1 before the first line and for empty lyrics", () => {
    expect(activeLineIndex(lines, 0)).toBe(-1);
    expect(activeLineIndex(lines, 999)).toBe(-1);
    expect(activeLineIndex([], 5000)).toBe(-1);
  });

  it("switches exactly at the start time of a line", () => {
    expect(activeLineIndex(lines, 1000)).toBe(0);
    expect(activeLineIndex(lines, 4999)).toBe(0);
    expect(activeLineIndex(lines, 5000)).toBe(1);
  });

  it("picks the last line when several share a time", () => {
    expect(activeLineIndex(lines, 9500)).toBe(3);
  });

  it("stays on the last line after the end", () => {
    expect(activeLineIndex(lines, 999_999)).toBe(4);
  });

  it("a positive offset delays the lyrics and a negative one advances them", () => {
    expect(activeLineIndex(lines, 5200, 500)).toBe(0);
    expect(activeLineIndex(lines, 4700, -500)).toBe(1);
  });

  it("returns -1 for non-finite input", () => {
    expect(activeLineIndex(lines, Number.NaN)).toBe(-1);
    expect(activeLineIndex(lines, 5000, Number.NaN)).toBe(-1);
  });

  it("handles a long list", () => {
    const many = Array.from({ length: 3000 }, (_, i) => L(i * 1000));
    expect(activeLineIndex(many, 1_234_567)).toBe(1234);
  });
});

describe("seekSecondsForLine", () => {
  const lines = [L(1000), L(5000), L(9000), L(20000)];

  it("lands on the clicked line for any reasonable offset", () => {
    for (const offset of [0, 400, -400, 2000]) {
      lines.forEach((line, i) => {
        const seconds = seekSecondsForLine(line, offset);
        expect(activeLineIndex(lines, seconds * 1000, offset)).toBe(i);
      });
    }
  });

  it("is never negative", () => {
    expect(seekSecondsForLine(L(500), -2000)).toBe(0);
  });
});

describe("formatOffset", () => {
  it("shows the sign and one decimal", () => {
    expect(formatOffset(500)).toBe("+0.5s");
    expect(formatOffset(-1500)).toBe("-1.5s");
    expect(formatOffset(10_000)).toBe("+10.0s");
  });

  it("never shows a negative zero", () => {
    expect(formatOffset(0)).toBe("0.0s");
    expect(formatOffset(-20)).toBe("0.0s");
  });
});