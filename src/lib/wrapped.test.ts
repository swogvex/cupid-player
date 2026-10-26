import { describe, expect, it } from "vitest";
import type { Wrapped } from "../ipc/types";
import { buildSlides, clampSlide, isDecember, monthName, wrappedYears } from "./wrapped";

function wrapped(overrides: Partial<Wrapped> = {}): Wrapped {
  return {
    year: 2026,
    minutes: 131,
    months: [{ monthKey: "2026-10", minutes: 131 }],
    topMonth: { monthKey: "2026-10", minutes: 131 },
    topArtists: [{ artist: "A", seconds: 600 }],
    topTracks: [{ title: "T", artist: "A", seconds: 600, plays: 3 }],
    ...overrides,
  };
}

describe("buildSlides", () => {
  it("builds the full sequence when there is listening", () => {
    expect(buildSlides(wrapped())).toEqual([
      "intro",
      "minutes",
      "artist",
      "song",
      "month",
      "artists",
      "songs",
      "outro",
    ]);
  });

  it("returns no slides for a year without listening", () => {
    const empty = wrapped({
      minutes: 0,
      months: [],
      topMonth: null,
      topArtists: [],
      topTracks: [],
    });
    expect(buildSlides(empty)).toEqual([]);
  });
});

describe("clampSlide", () => {
  it("stays inside the range and tolerates an empty list", () => {
    expect(clampSlide(-3, 5)).toBe(0);
    expect(clampSlide(2, 5)).toBe(2);
    expect(clampSlide(9, 5)).toBe(4);
    expect(clampSlide(3, 0)).toBe(0);
  });
});

describe("wrappedYears", () => {
  it("lists the years with listening plus the current one, newest first", () => {
    expect(wrappedYears(["2026-10", "2026-03", "2024-12"], 2026)).toEqual([2026, 2024]);
    expect(wrappedYears(["2025-01"], 2026)).toEqual([2026, 2025]);
    expect(wrappedYears(["nope", "26-01"], 2026)).toEqual([2026]);
    expect(wrappedYears([], 2026)).toEqual([2026]);
  });
});

describe("monthName", () => {
  it("names the month in the given language, capitalized", () => {
    expect(monthName("2026-10", "en")).toBe("October");
    expect(monthName("2026-10", "es")).toBe("Octubre");
    expect(monthName("garbage", "en")).toBe("garbage");
  });
});

describe("isDecember", () => {
  it("is true only in December", () => {
    expect(isDecember(new Date(2026, 11, 1))).toBe(true);
    expect(isDecember(new Date(2026, 10, 30))).toBe(false);
    expect(isDecember(new Date(2027, 0, 1))).toBe(false);
  });
});