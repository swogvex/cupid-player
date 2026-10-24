import { create } from "zustand";

export type NameDialog =
  | { mode: "create"; /** Add this track right after creating (from "Add to playlist…"). */ addTrackId?: number }
  | { mode: "rename"; playlistId: number };

interface PlaylistMenuState {
  /** `playlistId: null` is the empty area of the playlists list. */
  menu: { x: number; y: number; playlistId: number | null } | null;
  nameDialog: NameDialog | null;
  /** Playlist that is receiving songs from the library picker. */
  pickerFor: number | null;
  deletingId: number | null;
  /** Track being added to a playlist ("Add to playlist…"). */
  addingTrackId: number | null;
  openMenu: (x: number, y: number, playlistId: number | null) => void;
  closeMenu: () => void;
  openName: (dialog: NameDialog) => void;
  closeName: () => void;
  openPicker: (playlistId: number) => void;
  closePicker: () => void;
  openDelete: (playlistId: number) => void;
  closeDelete: () => void;
  openAddTo: (trackId: number) => void;
  closeAddTo: () => void;
  reset: () => void;
}

export const usePlaylistMenuStore = create<PlaylistMenuState>((set) => ({
  menu: null,
  nameDialog: null,
  pickerFor: null,
  deletingId: null,
  addingTrackId: null,
  openMenu: (x, y, playlistId) => set({ menu: { x, y, playlistId } }),
  closeMenu: () => set({ menu: null }),
  openName: (nameDialog) => set({ nameDialog }),
  closeName: () => set({ nameDialog: null }),
  openPicker: (pickerFor) => set({ pickerFor }),
  closePicker: () => set({ pickerFor: null }),
  openDelete: (deletingId) => set({ deletingId }),
  closeDelete: () => set({ deletingId: null }),
  openAddTo: (addingTrackId) => set({ addingTrackId }),
  closeAddTo: () => set({ addingTrackId: null }),
  reset: () =>
    set({ menu: null, nameDialog: null, pickerFor: null, deletingId: null, addingTrackId: null }),
}));