import { create } from "zustand";

interface TrackMenuState {
  /** `playlistId` is set when the track was right-clicked inside a playlist. */
  menu: { trackId: number; x: number; y: number; playlistId: number | null } | null;
  editingId: number | null;
  deletingId: number | null;
  /** Short message shown as a toast. */
  notice: string | null;
  openMenu: (trackId: number, x: number, y: number, playlistId?: number | null) => void;
  closeMenu: () => void;
  openEdit: (trackId: number) => void;
  closeEdit: () => void;
  openDelete: (trackId: number) => void;
  closeDelete: () => void;
  notify: (message: string) => void;
  reset: () => void;
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined;

export const useTrackMenuStore = create<TrackMenuState>((set) => ({
  menu: null,
  editingId: null,
  deletingId: null,
  notice: null,
  openMenu: (trackId, x, y, playlistId = null) => set({ menu: { trackId, x, y, playlistId } }),
  closeMenu: () => set({ menu: null }),
  openEdit: (trackId) => set({ editingId: trackId }),
  closeEdit: () => set({ editingId: null }),
  openDelete: (trackId) => set({ deletingId: trackId }),
  closeDelete: () => set({ deletingId: null }),
  notify: (message) => {
    clearTimeout(noticeTimer);
    set({ notice: message });
    noticeTimer = setTimeout(() => set({ notice: null }), 4000);
  },
  reset: () => {
    clearTimeout(noticeTimer);
    set({ menu: null, editingId: null, deletingId: null, notice: null });
  },
}));