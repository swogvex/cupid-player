import { create } from 'zustand';
import { listPlaylists, listTracks } from '../ipc/commands';
import type { Playlist, Track, TrackFilter, TrackStatus } from '../ipc/types';

interface LibraryState {
  tracks: Track[];
  playlists: Playlist[];
  loading: boolean;
  error: string | null;
  load: (filter?: TrackFilter) => Promise<void>;
  /** Updates one row in place (live import progress) without reloading. */
  setTrackStatus: (id: number, status: TrackStatus) => void;
}

export const useLibraryStore = create<LibraryState>((set) => ({
  tracks: [],
  playlists: [],
  loading: false,
  error: null,
  load: async (filter) => {
    set({ loading: true, error: null });
    try {
      const [tracks, playlists] = await Promise.all([listTracks(filter), listPlaylists()]);
      set({ tracks, playlists, loading: false });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },
  setTrackStatus: (id, status) =>
    set((s) => ({ tracks: s.tracks.map((t) => (t.id === id ? { ...t, status } : t)) })),
}));