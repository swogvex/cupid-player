import { describe, expect, it } from "vitest";
import { currentMonthKey, formatListened, mergeMonths, monthLabel } from "./stats";

describe("stats helpers", () => {
  it("builds the local month key", () => {
    expect(currentMonthKey(new Date(2026, 9, 24, 12, 0))).toBe("2026-10");
    expect(currentMonthKey(new Date(2026, 0, 1, 0, 5))).toBe("2026-01");
    expect(currentMonthKey(new Date(2026, 11, 31, 23, 59))).toBe("2026-12");
  });

  it("merges months newest first without duplicates", () => {
    expect(mergeMonths(["2026-08", "2026-09", "2026-08"], "2026-10")).toEqual([
      "2026-10",
      "2026-09",
      "2026-08",
    ]);
    expect(mergeMonths(["2026-10", "2026-07"], "2026-10")).toEqual(["2026-10", "2026-07"]);
    expect(mergeMonths([], "2026-10")).toEqual(["2026-10"]);
  });

  it("formats listened time", () => {
    expect(formatListened(0)).toBe("0 s");
    expect(formatListened(33)).toBe("33 s");
    expect(formatListened(59.6)).toBe("1 min");
    expect(formatListened(600)).toBe("10 min");
    expect(formatListened(3600)).toBe("1 h");
    expect(formatListened(3900)).toBe("1 h 05 min");
  });

  it("labels a month in the UI language", () => {
    expect(monthLabel("2026-10", "en")).toBe("October 2026");
    expect(monthLabel("2026-10", "es")).toBe("Octubre de 2026");
    expect(monthLabel("nope", "en")).toBe("nope");
  });
});