import { create } from "zustand";
import { checkUpdate, installUpdate } from "../ipc/commands";
import type { UpdateInfo } from "../ipc/types";

type Phase = "idle" | "checking" | "none" | "available" | "installing" | "error";

type UpdaterState = {
  phase: Phase;
  info: UpdateInfo | null;
  /** Raw rejection from Rust (a stable code such as "updater.check_failed"). */
  error: unknown;
  check: () => Promise<void>;
  install: () => Promise<void>;
  /** Once-a-day check at startup; silent on failure. */
  autoCheck: () => void;
};

const LAST_CHECK_KEY = "cupid.lastUpdateCheck";
const DAY_MS = 24 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 10_000;

function lastCheck(): number {
  try {
    const n = Number(localStorage.getItem(LAST_CHECK_KEY));
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function markChecked(): void {
  try {
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
  } catch {
    /* storage unavailable: the check just runs again next time */
  }
}

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  phase: "idle",
  info: null,
  error: null,

  check: async () => {
    const { phase } = get();
    if (phase === "checking" || phase === "installing") return;
    set({ phase: "checking", error: null });
    markChecked();
    try {
      const info = await checkUpdate();
      set(info ? { phase: "available", info } : { phase: "none", info: null });
    } catch (e) {
      set({ phase: "error", error: e });
    }
  },

  install: async () => {
    if (get().phase !== "available") return;
    set({ phase: "installing", error: null });
    try {
      // On Windows the installer closes the app, so this promise normally never resolves.
      await installUpdate();
    } catch (e) {
      // The update stays pending in Rust: the user can try again.
      set({ phase: "available", error: e });
    }
  },

  autoCheck: () => {
    if (import.meta.env.DEV) return;
    if (Date.now() - lastCheck() < DAY_MS) return;
    window.setTimeout(() => {
      void get()
        .check()
        .then(() => {
          // Nobody asked for this check: a failure stays silent.
          if (get().phase === "error") set({ phase: "idle", error: null });
        });
    }, STARTUP_DELAY_MS);
  },
}));