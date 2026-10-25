import { create } from "zustand";

export type View = "library" | "playlists" | "stats" | "settings";

interface NavState {
  view: View;
  /** Playlist opened inside PlaylistsView, or null for the grid. */
  openPlaylistId: number | null;
  /** The lyrics view (heart button) replaces the current view while it is open. */
  lyricsOpen: boolean;
  go: (view: View) => void;
  openPlaylist: (id: number | null) => void;
  toggleLyrics: () => void;
}

export const useNavStore = create<NavState>((set) => ({
  view: "library",
  openPlaylistId: null,
  lyricsOpen: false,
  // Changing view always closes any opened playlist and the lyrics.
  go: (view) => set({ view, openPlaylistId: null, lyricsOpen: false }),
  openPlaylist: (id) => set({ view: "playlists", openPlaylistId: id, lyricsOpen: false }),
  toggleLyrics: () => set((s) => ({ lyricsOpen: !s.lyricsOpen })),
}));