import { create } from "zustand";

export type View = "library" | "playlists" | "stats" | "settings";

interface NavState {
  view: View;
  /** Playlist opened inside PlaylistsView, or null for the grid. */
  openPlaylistId: number | null;
  go: (view: View) => void;
  openPlaylist: (id: number | null) => void;
}

export const useNavStore = create<NavState>((set) => ({
  view: "library",
  openPlaylistId: null,
  // Changing view always closes any opened playlist.
  go: (view) => set({ view, openPlaylistId: null }),
  openPlaylist: (id) => set({ view: "playlists", openPlaylistId: id }),
}));