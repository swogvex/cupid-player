import { create } from "zustand";
import { getLyrics, getLyricsOffset, setLyricsOffset } from "../ipc/commands";
import type { Lyrics } from "../ipc/types";

export type LyricsPhase = "idle" | "loading" | "ready" | "error";

/** Largest shift the user can apply, in either direction (Rust enforces it too). */
export const OFFSET_LIMIT_MS = 10_000;
/** How much each press of the +/- buttons moves the lyrics. */
export const OFFSET_STEP_MS = 500;
/** Wait this long after the last press before saving, so one burst is one write. */
const SAVE_DELAY_MS = 400;

const clampOffset = (ms: number): number =>
  Number.isFinite(ms) ? Math.max(-OFFSET_LIMIT_MS, Math.min(OFFSET_LIMIT_MS, Math.round(ms))) : 0;

// --- Saving the offset (best effort, one pending write at a time) ---
let pending: { trackId: number; offsetMs: number } | null = null;
let saveTimer: number | undefined;

/** Sends the pending offset to Rust right away. A failure is ignored: it is only a preference. */
function flushOffset(): void {
  window.clearTimeout(saveTimer);
  if (pending === null) return;
  const { trackId, offsetMs } = pending;
  pending = null;
  setLyricsOffset(trackId, offsetMs).catch(() => undefined);
}

function scheduleOffsetSave(trackId: number, offsetMs: number): void {
  pending = { trackId, offsetMs };
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flushOffset, SAVE_DELAY_MS);
}

if (typeof window !== "undefined") window.addEventListener("pagehide", flushOffset);

type LyricsState = {
  trackId: number | null;
  phase: LyricsPhase;
  lyrics: Lyrics | null;
  /** Stable code such as "lyrics.unavailable" (translated by the UI). */
  error: string | null;
  /** > 0 shows the lyrics later. Loaded with the lyrics, saved per song. */
  offsetMs: number;

  /**
   * Loads the lyrics of a track (null clears). Does nothing if that track is already
   * loaded or loading, unless `refresh`. Calling it again after an error retries.
   */
  load: (trackId: number | null, refresh?: boolean) => void;
  /** Sets the shift and saves it for the current song. */
  setOffset: (ms: number) => void;
  nudgeOffset: (deltaMs: number) => void;
};

const errorCode = (e: unknown): string => (typeof e === "string" ? e : "lyrics.failed");

export const useLyricsStore = create<LyricsState>((set, get) => {
  /** Only the latest request may write: a slow answer for a previous track is dropped. */
  let request = 0;

  return {
    trackId: null,
    phase: "idle",
    lyrics: null,
    error: null,
    offsetMs: 0,

    load: (trackId, refresh = false) => {
      flushOffset(); // whatever was pending belongs to the previous song
      const s = get();
      if (trackId === null) {
        request += 1;
        set({ trackId: null, phase: "idle", lyrics: null, error: null, offsetMs: 0 });
        return;
      }
      const same = trackId === s.trackId;
      if (!refresh && same && (s.phase === "ready" || s.phase === "loading")) return;

      const mine = ++request;
      set({
        trackId,
        phase: "loading",
        error: null,
        // Refreshing keeps the old text on screen until the new answer arrives.
        lyrics: same ? s.lyrics : null,
        offsetMs: same ? s.offsetMs : 0,
      });
      Promise.all([getLyrics(trackId, refresh), getLyricsOffset(trackId).catch(() => 0)])
        .then(([lyrics, saved]) => {
          if (mine !== request) return;
          // The same song keeps what is on screen; a different one takes the saved value.
          set((cur) => ({
            phase: "ready",
            lyrics,
            offsetMs: same ? cur.offsetMs : clampOffset(saved),
          }));
        })
        .catch((e: unknown) => {
          if (mine === request) set({ phase: "error", error: errorCode(e) });
        });
    },

    setOffset: (ms) => {
      const { trackId, lyrics } = get();
      const value = clampOffset(ms);
      set({ offsetMs: value });
      if (trackId !== null && lyrics !== null && lyrics.trackId === trackId && lyrics.status === "synced") {
        scheduleOffsetSave(trackId, value);
      }
    },

    nudgeOffset: (deltaMs) => get().setOffset(get().offsetMs + deltaMs),
  };
});