import { create } from "zustand";

export type View = "library" | "playlists" | "stats" | "settings";

interface NavState {
  view: View;
  /** Playlist opened inside PlaylistsView, or null for the grid. */
  openPlaylistId: number | null;
  /** The lyrics view (lyrics button) replaces the current view while it is open. */
  lyricsOpen: boolean;
  /** The yearly Wrapped replaces the content panel; the sidebar keeps showing Stats. */
  wrappedOpen: boolean;
  go: (view: View) => void;
  openPlaylist: (id: number | null) => void;
  toggleLyrics: () => void;
  openWrapped: () => void;
  closeWrapped: () => void;
}

export const useNavStore = create<NavState>((set) => ({
  view: "library",
  openPlaylistId: null,
  lyricsOpen: false,
  wrappedOpen: false,
  // Changing view always closes any opened playlist, the lyrics and the Wrapped.
  go: (view) => set({ view, openPlaylistId: null, lyricsOpen: false, wrappedOpen: false }),
  openPlaylist: (id) =>
    set({ view: "playlists", openPlaylistId: id, lyricsOpen: false, wrappedOpen: false }),
  toggleLyrics: () => set((s) => ({ lyricsOpen: !s.lyricsOpen })),
  openWrapped: () => set({ view: "stats", lyricsOpen: false, wrappedOpen: true }),
  closeWrapped: () => set({ wrappedOpen: false }),
}));