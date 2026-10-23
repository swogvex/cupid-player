import type { Track } from "../ipc/types";

/** Lowercase, no accents ("Beyoncé" -> "beyonce"). Uses the platform's Unicode, no dependency. */
export function normalizeSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Splits a query into normalized words; every word must match (in any field). */
export function searchTokens(query: string): string[] {
  const n = normalizeSearch(query).trim();
  return n === "" ? [] : n.split(/\s+/);
}

// Rows keep their object identity between store updates unless they change,
// so the normalized text is computed once per track version.
const haystacks = new WeakMap<Track, string>();

function haystack(track: Track): string {
  let h = haystacks.get(track);
  if (h === undefined) {
    h = normalizeSearch(`${track.title} ${track.artist} ${track.album ?? ""}`);
    haystacks.set(track, h);
  }
  return h;
}

export function filterTracks(tracks: Track[], query: string): Track[] {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return tracks;
  return tracks.filter((tr) => {
    const h = haystack(tr);
    return tokens.every((tok) => h.includes(tok));
  });
}