import { create } from "zustand";
import { setMiniMode } from "../ipc/commands";
import { applyCssScale, setScaleMode } from "../lib/scale";

type MiniState = {
  mini: boolean;
  busy: boolean;
  setMini: (on: boolean) => Promise<void>;
  toggle: () => Promise<void>;
};

/** Not persisted on purpose: the app always starts in normal mode. */
export const useMiniStore = create<MiniState>((set, get) => ({
  mini: false,
  busy: false,

  setMini: async (on) => {
    if (get().busy || get().mini === on) return;
    set({ busy: true });
    try {
      await setMiniMode(on);
      setScaleMode(on ? "mini" : "full");
      set({ mini: on });
      applyCssScale();
    } catch (e) {
      console.error("mini: could not switch mode", e);
    } finally {
      set({ busy: false });
    }
  },

  toggle: () => get().setMini(!get().mini),
}));