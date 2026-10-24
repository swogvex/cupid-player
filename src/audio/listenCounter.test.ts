import { describe, expect, it } from "vitest";
import { createListenCounter, type ListenCounter } from "./listenCounter";

function setup(opts: { updateResult?: boolean; failFirstStart?: boolean } = {}) {
  const starts: number[] = [];
  const updates: [number, number][] = [];
  let startAttempts = 0;
  const counter = createListenCounter({
    startPlay: async (trackId) => {
      startAttempts += 1;
      if (opts.failFirstStart && startAttempts === 1) throw new Error("database error");
      starts.push(trackId);
      return 100 + starts.length;
    },
    updatePlay: async (playId, seconds) => {
      updates.push([playId, seconds]);
      return opts.updateResult ?? true;
    },
  });
  return { counter, starts, updates };
}

/** Simulates `timeupdate` events every 0.25 s (both ends included). */
function playRange(counter: ListenCounter, from: number, to: number): void {
  for (let p = from; p <= to + 1e-9; p += 0.25) counter.tick(p);
}

const last = <T>(items: T[]): T | undefined => items[items.length - 1];

describe("listen counter", () => {
  it("adds nothing while paused, even if the position moves", async () => {
    const { counter, starts, updates } = setup();
    counter.setTrack(1);
    counter.setPlaying(true);
    playRange(counter, 0, 3);
    counter.setPlaying(false);
    playRange(counter, 3, 9); // e.g. the user drags the star while paused
    counter.finish();
    await counter.idle();
    expect(starts).toEqual([]);
    expect(updates).toEqual([]);
  });

  it("keeps the same session across a pause", async () => {
    const { counter, starts, updates } = setup();
    counter.setTrack(1);
    counter.setPlaying(true);
    playRange(counter, 0, 4);
    counter.setPlaying(false);
    counter.setPlaying(true);
    playRange(counter, 4, 8);
    counter.finish();
    await counter.idle();
    expect(starts).toEqual([1]);
    expect(last(updates)).toEqual([101, 8]);
  });

  it("creates the row after 5 s and then saves checkpoints", async () => {
    const { counter, starts, updates } = setup();
    counter.setTrack(7);
    counter.setPlaying(true);
    playRange(counter, 0, 4.75);
    await counter.idle();
    expect(starts).toEqual([]); // 4.75 s: below the threshold

    playRange(counter, 5, 5);
    await counter.idle();
    expect(starts).toEqual([7]);
    expect(updates).toEqual([[101, 5]]);

    playRange(counter, 5.25, 12);
    counter.checkpoint();
    await counter.idle();
    expect(last(updates)).toEqual([101, 12]);

    counter.finish(); // nothing new to save
    await counter.idle();
    expect(starts).toEqual([7]);
    expect(updates).toHaveLength(2);
  });

  it("does not count seeks, forward or backward", async () => {
    const { counter, updates } = setup();
    counter.setTrack(1);
    counter.setPlaying(true);
    playRange(counter, 0, 2); // 2 s
    counter.tick(100); // seek forward: the 98 s jump adds nothing
    playRange(counter, 100.25, 102); // +2 s (from 100 to 102)
    counter.tick(10); // seek backward: adds nothing
    playRange(counter, 10.25, 12); // +2 s (from 10 to 12) -> 6 s in total
    counter.finish();
    await counter.idle();
    expect(last(updates)).toEqual([101, 6]);
  });

  it("saves each track as its own session when the track changes", async () => {
    const { counter, starts, updates } = setup();
    counter.setTrack(1);
    counter.setPlaying(true);
    playRange(counter, 0, 10);
    counter.setTrack(2); // keeps playing: no pause event in between
    playRange(counter, 0, 6);
    counter.finish();
    await counter.idle();
    expect(starts).toEqual([1, 2]);
    expect(updates).toEqual([
      [101, 5],
      [101, 10],
      [102, 5],
      [102, 6],
    ]);
  });

  it("leaves no trace for a skipped song", async () => {
    const { counter, starts, updates } = setup();
    counter.setTrack(1);
    counter.setPlaying(true);
    playRange(counter, 0, 3);
    counter.setTrack(2);
    playRange(counter, 0, 3);
    counter.finish();
    await counter.idle();
    expect(starts).toEqual([]);
    expect(updates).toEqual([]);
  });

  it("counts every loop of 'repeat one' as its own session", async () => {
    const { counter, starts, updates } = setup();
    counter.setTrack(1);
    counter.setPlaying(true);
    playRange(counter, 0, 6);
    counter.finish(); // the engine's "ended" event
    playRange(counter, 0, 6); // the song restarts from 0
    counter.finish();
    await counter.idle();
    expect(starts).toEqual([1, 1]);
    expect(updates).toEqual([
      [101, 5],
      [101, 6],
      [102, 5],
      [102, 6],
    ]);
  });

  it("stops saving when the session no longer exists", async () => {
    const { counter, updates } = setup({ updateResult: false });
    counter.setTrack(1);
    counter.setPlaying(true);
    playRange(counter, 0, 8);
    counter.finish();
    await counter.idle();
    expect(updates).toEqual([[101, 5]]); // the track was deleted: no more attempts
  });

  it("retries when the first save fails", async () => {
    const { counter, starts, updates } = setup({ failFirstStart: true });
    counter.setTrack(1);
    counter.setPlaying(true);
    playRange(counter, 0, 5);
    await counter.idle();
    expect(starts).toEqual([]); // the first attempt failed
    playRange(counter, 5.25, 8);
    counter.finish();
    await counter.idle();
    expect(starts).toEqual([1]);
    expect(updates).toEqual([[101, 8]]);
  });

  it("only sends whole seconds", async () => {
    const { counter, starts, updates } = setup();
    counter.setTrack(1);
    counter.setPlaying(true);
    for (let p = 0; p <= 12; p += 0.3) counter.tick(p);
    counter.finish();
    await counter.idle();
    expect(starts).toHaveLength(1);
    expect(updates.length).toBeGreaterThan(0);
    expect(updates.every(([, seconds]) => Number.isInteger(seconds))).toBe(true);
  });
});