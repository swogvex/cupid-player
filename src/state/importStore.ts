import { create } from "zustand";
import { cancelImport, retryTrack, startImport } from "../ipc/commands";
import { onImportDone, onImportProgress, onLibraryChanged, onTrackState } from "../ipc/events";
import type { ImportStarted } from "../ipc/types";
import { useLibraryStore } from "./libraryStore";

export type ImportPhase = "idle" | "starting" | "running" | "done" | "error";

interface ImportData {
  phase: ImportPhase;
  importId: string | null;
  /** 0..1 over the tracks being downloaded. */
  fraction: number;
  finished: number;
  total: number;
  needsReview: number;
  failed: number;
  cancelled: boolean;
  cancelling: boolean;
  /** The playlist may have more tracks than Spotify's embed shows. */
  truncated: boolean;
  /** Nothing to download: everything was already imported. */
  alreadyImported: boolean;
  errorCode: string | null;
}

const INITIAL: ImportData = {
  phase: "idle",
  importId: null,
  fraction: 0,
  finished: 0,
  total: 0,
  needsReview: 0,
  failed: 0,
  cancelled: false,
  cancelling: false,
  truncated: false,
  alreadyImported: false,
  errorCode: null,
};

interface ImportState extends ImportData {
  /** Increases with every import started, so the progress bar restarts from the left. */
  runId: number;
  /** Resolves true when the import started (or had nothing to do). */
  start: (url: string) => Promise<boolean>;
  retry: (trackId: number) => Promise<boolean>;
  cancel: () => void;
  reset: () => void;
}

/** Rust sends stable codes like "embed.not_found"; anything else is a generic error. */
export function toErrorCode(e: unknown): string {
  return typeof e === "string" && /^[a-z_]+\.[a-z_]+$/.test(e) ? e : "unknown";
}

export const useImportStore = create<ImportState>((set, get) => {
  const run = async (launch: () => Promise<ImportStarted>): Promise<boolean> => {
    set({ ...INITIAL, phase: "starting", runId: get().runId + 1 });
    try {
      const started = await launch();
      if (started.toDownload === 0) {
        set({ ...INITIAL, phase: "done", fraction: 1, alreadyImported: true, truncated: started.truncated });
      } else {
        set((s) =>
          s.phase === "done"
            ? { truncated: started.truncated } // the done event already arrived
            : {
                phase: "running",
                importId: s.importId ?? started.importId,
                total: started.toDownload,
                truncated: started.truncated,
              },
        );
      }
      void useLibraryStore.getState().load(); // the new rows exist already
      return true;
    } catch (e) {
      set({ ...INITIAL, phase: "error", errorCode: toErrorCode(e) });
      return false;
    }
  };

  return {
    ...INITIAL,
    runId: 0,
    start: (url) => run(() => startImport(url)),
    retry: (trackId) => run(() => retryTrack(trackId)),
    cancel: () => {
      const { importId, cancelling, phase } = get();
      if (!importId || cancelling || phase !== "running") return;
      set({ cancelling: true });
      void cancelImport(importId);
    },
    reset: () => set({ ...INITIAL }),
  };
});

/** Events are accepted only while an import runs and only from the known import. */
function accepts(importId: string): boolean {
  const s = useImportStore.getState();
  if (s.phase !== "starting" && s.phase !== "running") return false;
  return s.importId === null || s.importId === importId;
}

let reloadTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleLibraryReload(): void {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => void useLibraryStore.getState().load(), 300);
}

/** Subscribes to the import events. Returns the function that unsubscribes. */
export function initImportEvents(): () => void {
  const pending = [
    onImportProgress((p) => {
      if (!accepts(p.importId)) return;
      useImportStore.setState((s) => ({
        phase: "running",
        importId: s.importId ?? p.importId,
        fraction: p.fraction,
        finished: p.finished,
        total: p.total,
      }));
    }),
    onTrackState((p) => {
      useLibraryStore.getState().setTrackStatus(p.trackId, p.status);
    }),
    onImportDone((d) => {
      if (!accepts(d.importId)) return;
      useImportStore.setState((s) => ({
        phase: "done",
        importId: s.importId ?? d.importId,
        fraction: d.cancelled ? s.fraction : 1,
        finished: d.total,
        total: d.total,
        needsReview: d.needsReview,
        failed: d.failed,
        cancelled: d.cancelled,
        cancelling: false,
      }));
    }),
    onLibraryChanged(scheduleLibraryReload),
  ];
  return () => {
    pending.forEach((p) => void p.then((unlisten) => unlisten()));
  };
}