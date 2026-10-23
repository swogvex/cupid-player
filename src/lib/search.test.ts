import { describe, expect, it } from "vitest";
import type { Track } from "../ipc/types";
import { filterTracks, normalizeSearch, searchTokens } from "./search";

function track(id: number, title: string, artist: string, album: string | null = null): Track {
  return {
    id,
    spotifyId: null,
    title,
    artist,
    album,
    durationMs: 1000,
    filePath: null,
    coverPath: null,
    playlistId: null,
    position: null,
    status: "done",
    sourceUrl: null,
    matchScore: null,
    addedAt: "2026-10-22T00:00:00Z",
  };
}

const LIB = [
  track(1, "C’est La Vie", "Amaia", "Pantera"),
  track(2, "Halo", "Beyoncé"),
  track(3, "Scars leave beautiful trace", "Car, the garden"),
  track(4, "腹芸", "Someone"),
];

describe("search", () => {
  it("ignores case and accents", () => {
    expect(normalizeSearch("Beyoncé")).toBe("beyonce");
    expect(filterTracks(LIB, "BEYONCE").map((t) => t.id)).toEqual([2]);
    expect(filterTracks(LIB, "beyoncé").map((t) => t.id)).toEqual([2]);
  });

  it("matches title, artist and album", () => {
    expect(filterTracks(LIB, "vie").map((t) => t.id)).toEqual([1]);
    expect(filterTracks(LIB, "amaia").map((t) => t.id)).toEqual([1]);
    expect(filterTracks(LIB, "pantera").map((t) => t.id)).toEqual([1]);
  });

  it("requires every word, in any field", () => {
    expect(filterTracks(LIB, "amaia vie").map((t) => t.id)).toEqual([1]);
    expect(filterTracks(LIB, "amaia halo")).toEqual([]);
    expect(filterTracks(LIB, "car, garden").map((t) => t.id)).toEqual([3]); // the comma is part of the word
    expect(filterTracks(LIB, "car the").map((t) => t.id)).toEqual([3]);
  });

  it("returns everything for an empty query and handles non-latin text", () => {
    expect(filterTracks(LIB, "   ")).toBe(LIB);
    expect(searchTokens("  a   b ")).toEqual(["a", "b"]);
    expect(filterTracks(LIB, "腹芸").map((t) => t.id)).toEqual([4]);
  });
});