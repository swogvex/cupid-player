import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ImportDonePayload, ImportProgressPayload, TrackStatePayload } from "./types";

// Single entry point for Rust -> React events: components never call listen() directly.
export const onImportProgress = (cb: (p: ImportProgressPayload) => void): Promise<UnlistenFn> =>
  listen<ImportProgressPayload>("import://progress", (e) => cb(e.payload));

export const onTrackState = (cb: (p: TrackStatePayload) => void): Promise<UnlistenFn> =>
  listen<TrackStatePayload>("import://track-state", (e) => cb(e.payload));

export const onImportDone = (cb: (p: ImportDonePayload) => void): Promise<UnlistenFn> =>
  listen<ImportDonePayload>("import://done", (e) => cb(e.payload));

export const onLibraryChanged = (cb: () => void): Promise<UnlistenFn> =>
  listen("library://changed", () => cb());