import type { Track } from "../ipc/types";

/** The tracks of a playlist, in playlist order. Ids not in the library are skipped. */
export function tracksOfPlaylist(
  tracks: Track[],
  members: Record<number, number[]>,
  playlistId: number,
): Track[] {
  const byId = new Map(tracks.map((t) => [t.id, t] as const));
  const out: Track[] = [];
  for (const id of members[playlistId] ?? []) {
    const track = byId.get(id);
    if (track) out.push(track);
  }
  return out;
}