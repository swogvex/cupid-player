import { create } from 'zustand';
import { listPlaylistMembers, listPlaylists, listTracks } from '../ipc/commands';
import type { Playlist, PlaylistMember, Track, TrackFilter, TrackStatus } from '../ipc/types';

interface LibraryState {
  tracks: Track[];
  playlists: Playlist[];
  /** Playlist id -> its track ids, in playlist order. */
  members: Record<number, number[]>;
  loading: boolean;
  error: string | null;
  load: (filter?: TrackFilter) => Promise<void>;
  /** Updates one row in place (live import progress) without reloading. */
  setTrackStatus: (id: number, status: TrackStatus) => void;
  /** Swaps a row for the version returned by the backend (after editing). */
  replaceTrack: (track: Track) => void;
  /** Removes a track from the library (and so from every playlist). */
  removeTrack: (id: number) => void;
}

function groupMembers(rows: PlaylistMember[]): Record<number, number[]> {
  const out: Record<number, number[]> = {};
  for (const m of rows) (out[m.playlistId] ??= []).push(m.trackId);
  return out;
}

export const useLibraryStore = create<LibraryState>((set) => ({
  tracks: [],
  playlists: [],
  members: {},
  loading: false,
  error: null,
  load: async (filter) => {
    set({ loading: true, error: null });
    try {
      const [tracks, playlists, members] = await Promise.all([
        listTracks(filter),
        listPlaylists(),
        listPlaylistMembers(),
      ]);
      set({ tracks, playlists, members: groupMembers(members), loading: false });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },
  setTrackStatus: (id, status) =>
    set((s) => ({ tracks: s.tracks.map((t) => (t.id === id ? { ...t, status } : t)) })),
  replaceTrack: (track) =>
    set((s) => ({ tracks: s.tracks.map((t) => (t.id === track.id ? track : t)) })),
  removeTrack: (id) =>
    set((s) => ({
      tracks: s.tracks.filter((t) => t.id !== id),
      members: Object.fromEntries(
        Object.entries(s.members).map(([pid, ids]) => [pid, ids.filter((x) => x !== id)]),
      ),
    })),
}));