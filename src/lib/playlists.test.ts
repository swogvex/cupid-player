import { describe, expect, it } from "vitest";
import type { Track } from "../ipc/types";
import { tracksOfPlaylist } from "./playlists";

function track(id: number): Track {
  return {
    id,
    spotifyId: null,
    title: `T${id}`,
    artist: "A",
    album: null,
    durationMs: 1000,
    filePath: null,
    coverPath: null,
    playlistId: null,
    position: null,
    status: "done",
    sourceUrl: null,
    matchScore: null,
    addedAt: "2026-10-24T00:00:00Z",
  };
}

describe("tracksOfPlaylist", () => {
  const tracks = [track(1), track(2), track(3)];

  it("keeps the playlist order, not the library order", () => {
    expect(tracksOfPlaylist(tracks, { 7: [3, 1] }, 7).map((t) => t.id)).toEqual([3, 1]);
  });

  it("skips ids that are no longer in the library and unknown playlists", () => {
    expect(tracksOfPlaylist(tracks, { 7: [9, 2] }, 7).map((t) => t.id)).toEqual([2]);
    expect(tracksOfPlaylist(tracks, {}, 7)).toEqual([]);
  });
});