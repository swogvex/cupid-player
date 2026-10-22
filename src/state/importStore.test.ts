import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportStarted, Track } from "../ipc/types";

const handlers = vi.hoisted(() => ({}) as Record<string, (payload?: unknown) => void>);

vi.mock("../ipc/commands", () => ({
  startImport: vi.fn(),
  retryTrack: vi.fn(),
  cancelImport: vi.fn(),
  listTracks: vi.fn().mockResolvedValue([]),
  listPlaylists: vi.fn().mockResolvedValue([]),
}));

vi.mock("../ipc/events", () => {
  const register = (name: string) => (cb: (payload?: unknown) => void) => {
    handlers[name] = cb;
    return Promise.resolve(() => undefined);
  };
  return {
    onImportProgress: register("progress"),
    onTrackState: register("track"),
    onImportDone: register("done"),
    onLibraryChanged: register("library"),
  };
});

import { cancelImport, listTracks, retryTrack, startImport } from "../ipc/commands";
import { initImportEvents, toErrorCode, useImportStore } from "./importStore";
import { useLibraryStore } from "./libraryStore";

const started = (over: Partial<ImportStarted> = {}): ImportStarted => ({
  importId: "imp1",
  playlistId: 1,
  name: "Mix",
  total: 4,
  toDownload: 4,
  alreadyDone: 0,
  skipped: 0,
  truncated: false,
  ...over,
});

const track: Track = {
  id: 7,
  spotifyId: null,
  title: "T",
  artist: "A",
  album: null,
  durationMs: 1000,
  filePath: null,
  coverPath: null,
  playlistId: null,
  position: null,
  status: "queued",
  sourceUrl: null,
  matchScore: null,
  addedAt: "2026-01-01T00:00:00Z",
};

const fire = (name: string, payload?: unknown) => {
  const handler = handlers[name];
  if (!handler) throw new Error(`no handler registered for ${name}`);
  handler(payload);
};

const state = () => useImportStore.getState();

let stopEvents: () => void;

beforeEach(() => {
  vi.mocked(startImport).mockReset();
  vi.mocked(retryTrack).mockReset();
  vi.mocked(cancelImport).mockReset();
  vi.mocked(listTracks).mockClear();
  state().reset();
  useLibraryStore.setState({ tracks: [] });
  stopEvents = initImportEvents();
});

afterEach(() => {
  stopEvents();
  vi.useRealTimers();
});

describe("importStore", () => {
  it("keeps stable error codes and hides anything else", () => {
    expect(toErrorCode("embed.not_found")).toBe("embed.not_found");
    expect(toErrorCode("import.busy")).toBe("import.busy");
    expect(toErrorCode("database error: disk full")).toBe("unknown");
    expect(toErrorCode(new Error("boom"))).toBe("unknown");
    expect(toErrorCode(undefined)).toBe("unknown");
  });

  it("start() moves to running with the totals and reloads the library", async () => {
    vi.mocked(startImport).mockResolvedValue(started({ truncated: true }));
    expect(await state().start("https://open.spotify.com/playlist/x")).toBe(true);
    expect(state()).toMatchObject({ phase: "running", importId: "imp1", total: 4, truncated: true });
    expect(startImport).toHaveBeenCalledWith("https://open.spotify.com/playlist/x");
    expect(listTracks).toHaveBeenCalled();
  });

  it("finishes immediately when there is nothing to download", async () => {
    vi.mocked(startImport).mockResolvedValue(started({ toDownload: 0, alreadyDone: 4 }));
    await state().start("x");
    expect(state()).toMatchObject({ phase: "done", alreadyImported: true, fraction: 1 });
  });

  it("keeps the error code when start() fails", async () => {
    vi.mocked(startImport).mockRejectedValue("import.busy");
    expect(await state().start("x")).toBe(false);
    expect(state()).toMatchObject({ phase: "error", errorCode: "import.busy" });

    vi.mocked(startImport).mockRejectedValue(new Error("boom"));
    await state().start("x");
    expect(state().errorCode).toBe("unknown");
  });

  it("progress and done events update the state", async () => {
    vi.mocked(startImport).mockResolvedValue(started());
    await state().start("x");
    fire("progress", { importId: "imp1", fraction: 0.5, finished: 2, total: 4 });
    expect(state()).toMatchObject({ phase: "running", fraction: 0.5, finished: 2 });

    fire("done", { importId: "imp1", total: 4, done: 3, needsReview: 1, failed: 0, cancelled: false });
    expect(state()).toMatchObject({ phase: "done", fraction: 1, needsReview: 1, cancelled: false });
  });

  it("ignores events of other imports and events when nothing is running", async () => {
    fire("progress", { importId: "imp1", fraction: 0.9, finished: 3, total: 4 });
    expect(state()).toMatchObject({ phase: "idle", fraction: 0 });

    vi.mocked(startImport).mockResolvedValue(started());
    await state().start("x");
    fire("progress", { importId: "other", fraction: 0.9, finished: 3, total: 4 });
    expect(state().fraction).toBe(0);
  });

  it("accepts events that arrive before start() resolves", async () => {
    let resolveStart: (s: ImportStarted) => void = () => undefined;
    vi.mocked(startImport).mockReturnValue(
      new Promise<ImportStarted>((resolve) => {
        resolveStart = resolve;
      }),
    );
    const pending = state().start("x");
    expect(state().phase).toBe("starting");

    fire("progress", { importId: "imp1", fraction: 0.1, finished: 0, total: 4 });
    expect(state()).toMatchObject({ phase: "running", importId: "imp1" });

    resolveStart(started());
    expect(await pending).toBe(true);
    expect(state()).toMatchObject({ phase: "running", importId: "imp1", total: 4 });
  });

  it("cancel() asks Rust once and marks the import as cancelling", () => {
    useImportStore.setState({ phase: "running", importId: "imp1" });
    state().cancel();
    state().cancel();
    expect(cancelImport).toHaveBeenCalledTimes(1);
    expect(cancelImport).toHaveBeenCalledWith("imp1");
    expect(state().cancelling).toBe(true);
  });

  it("track-state events update the row in the library", () => {
    useLibraryStore.setState({ tracks: [track] });
    fire("track", { importId: "imp1", trackId: 7, status: "downloading" });
    expect(useLibraryStore.getState().tracks[0]?.status).toBe("downloading");
  });

  it("retry() uses the retry command", async () => {
    vi.mocked(retryTrack).mockResolvedValue(started({ total: 1, toDownload: 1 }));
    expect(await state().retry(5)).toBe(true);
    expect(retryTrack).toHaveBeenCalledWith(5);
    expect(state()).toMatchObject({ phase: "running", total: 1 });
  });

  it("gives every import a new runId so the bar restarts from the left", async () => {
    vi.mocked(startImport).mockResolvedValue(started());
    const before = state().runId;
    await state().start("x");
    const first = state().runId;
    await state().start("y");
    expect(first).toBe(before + 1);
    expect(state().runId).toBe(first + 1);
  });

  it("reloads the library once after a burst of library changes", () => {
    vi.useFakeTimers();
    fire("library");
    fire("library");
    fire("library");
    expect(listTracks).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(listTracks).toHaveBeenCalledTimes(1);
  });
});