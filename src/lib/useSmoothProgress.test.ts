import { describe, expect, it } from "vitest";
import { stepProgress } from "./useSmoothProgress";

const FRAME = 16;

function run(shown: number, target: number, headroom: number, ms: number): number[] {
  const frames: number[] = [];
  let value = shown;
  for (let t = 0; t < ms; t += FRAME) {
    value = stepProgress(value, target, FRAME, headroom);
    frames.push(value);
  }
  return frames;
}

describe("stepProgress", () => {
  it("eases toward the target without overshooting", () => {
    const frames = run(0, 0.5, 0, 3000);
    frames.forEach((v, i) => {
      expect(v).toBeLessThanOrEqual(0.5);
      if (i > 0) expect(v).toBeGreaterThanOrEqual(frames[i - 1] ?? 0);
    });
    expect(frames[frames.length - 1]).toBeGreaterThan(0.49);
  });

  it("moves a little on each frame instead of jumping", () => {
    const first = stepProgress(0, 0.5, FRAME, 0);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.05);
  });

  it("creeps while waiting but never beyond the headroom", () => {
    const frames = run(0.2, 0.2, 0.04, 10_000);
    expect(Math.max(...frames)).toBeLessThanOrEqual(0.24);
    expect(frames[frames.length - 1]).toBeGreaterThan(0.23);
    expect(new Set(run(0.2, 0.2, 0, 5000))).toEqual(new Set([0.2]));
  });

  it("never goes backwards when the target is lower", () => {
    expect(stepProgress(0.5, 0.3, FRAME, 0.04)).toBe(0.5);
  });

  it("snaps to exactly 1 when the work is complete", () => {
    const frames = run(0.5, 1, 0, 3000);
    expect(frames[0]).toBeLessThan(1);
    expect(frames[frames.length - 1]).toBe(1);
  });

  it("does not jump after a long pause", () => {
    const long = stepProgress(0, 1, 60_000, 0);
    expect(long).toBe(stepProgress(0, 1, 250, 0));
    expect(long).toBeLessThan(1);
  });

  it("does nothing when no time passed", () => {
    expect(stepProgress(0.3, 0.8, 0, 0.05)).toBe(0.3);
  });

  it("tolerates invalid or out-of-range targets", () => {
    const nan = stepProgress(0.4, Number.NaN, FRAME, 0.05);
    expect(nan).toBeGreaterThanOrEqual(0.4);
    expect(nan).toBeLessThanOrEqual(0.45);
    expect(stepProgress(0.4, -1, FRAME, 0)).toBe(0.4);
    expect(stepProgress(0.4, 7, FRAME, 0)).toBeGreaterThan(0.4);
  });
});