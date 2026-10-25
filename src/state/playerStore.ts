import { create } from "zustand";
import * as engine from "../audio/engine";
import type { Track } from "../ipc/types";

export type RepeatMode = "off" | "one" | "all";

export type PlayerTrack = {
  id: number;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number;
  filePath: string;
  coverPath: string | null;
};

/** Only tracks with a downloaded file can be played. */
export function toPlayerTrack(t: Track): PlayerTrack | null {
  if (!t.filePath) return null;
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album ?? null,
    durationMs: t.durationMs,
    filePath: t.filePath,
    coverPath: t.coverPath ?? null,
  };
}

function shuffled<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

type PlayerState = {
  /** Actual play order. */
  queue: PlayerTrack[];
  /** Unshuffled order (same object references as `queue`). */
  baseQueue: PlayerTrack[];
  index: number;
  playing: boolean;
  /** Seconds. */
  position: number;
  duration: number;
  shuffle: boolean;
  repeat: RepeatMode;
  error: boolean;
  queueOpen: boolean;
  coverRev: number;

  playTracks: (tracks: Track[], startId?: number) => void;
  playAt: (index: number) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  seekRatio: (ratio: number) => void;
  /** Jumps to an absolute position (seconds), e.g. when a lyric line is clicked. */
  seekTo: (seconds: number) => void;
  seekBy: (seconds: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  enqueue: (track: Track) => void;
  playNext: (track: Track) => void;
  removeAt: (index: number) => void;
  move: (from: number, to: number) => void;
  clearQueue: () => void;
  toggleQueue: () => void;
  setQueueOpen: (open: boolean) => void;
  /** Refreshes the queue entries of a track after its tags or cover changed. */
  updateTrack: (track: Track) => void;
  /** Removes every queue entry of a track (e.g. before deleting it). */
  removeTrackById: (id: number) => void;

  // Called by the engine events (see audio/init.ts).
  _tick: (position: number, duration: number) => void;
  _setPlaying: (playing: boolean) => void;
  _started: () => void;
  _ended: () => void;
  _failed: () => void;
};

export const selectCurrent = (s: PlayerState): PlayerTrack | null => s.queue[s.index] ?? null;

export const usePlayerStore = create<PlayerState>((set, get) => {
  /** Consecutive load errors; reset when something actually plays. Avoids skipping forever. */
  let failures = 0;

  const open = (index: number, autoplay = true): void => {
    const track = get().queue[index];
    if (!track) return;
    set({ index, playing: autoplay, position: 0, duration: track.durationMs / 1000, error: false });
    engine.load(track.filePath, autoplay).catch(() => set({ playing: false }));
  };

  const advance = (auto: boolean): void => {
    const { index, queue, repeat } = get();
    if (index + 1 < queue.length) open(index + 1);
    else if (repeat === "all") open(0);
    else if (auto) open(0, false); // end of queue: back to the start, paused
  };

  return {
    queue: [],
    baseQueue: [],
    index: -1,
    playing: false,
    position: 0,
    duration: 0,
    shuffle: false,
    repeat: "off",
    error: false,
    queueOpen: false,
    coverRev: 0,

    playTracks: (tracks, startId) => {
      const list = tracks.map(toPlayerTrack).filter((t): t is PlayerTrack => t !== null);
      if (list.length === 0) return;
      const start = Math.max(0, startId === undefined ? 0 : list.findIndex((t) => t.id === startId));
      failures = 0;
      if (get().shuffle) {
        const first = list[start];
        set({ baseQueue: list, queue: [first, ...shuffled(list.filter((_, i) => i !== start))] });
        open(0);
      } else {
        set({ baseQueue: list, queue: list });
        open(start);
      }
    },

    playAt: (index) => {
      failures = 0;
      open(index);
    },

    play: () => {
      if (!get().queue[get().index]) return;
      set({ playing: true });
      engine.play().catch(() => set({ playing: false }));
    },

    pause: () => {
      engine.pause();
      set({ playing: false });
    },

    togglePlay: () => (get().playing ? get().pause() : get().play()),

    next: () => advance(false),

    prev: () => {
      const { index, queue, repeat, position } = get();
      if (position > 3) get().seekBy(-position);
      else if (index > 0) open(index - 1);
      else if (repeat === "all" && queue.length > 0) open(queue.length - 1);
      else get().seekBy(-position);
    },

    seekRatio: (ratio) => {
      const { duration } = get();
      if (duration <= 0) return;
      const pos = Math.min(1, Math.max(0, ratio)) * duration;
      engine.seek(pos);
      set({ position: pos });
    },

    seekTo: (seconds) => {
      if (!get().queue[get().index] || !Number.isFinite(seconds)) return;
      const { duration } = get();
      const pos = Math.max(0, duration > 0 ? Math.min(duration, seconds) : seconds);
      engine.seek(pos);
      set({ position: pos });
    },

    seekBy: (seconds) => {
      const { position, duration } = get();
      if (!get().queue[get().index]) return;
      const pos = Math.max(0, duration > 0 ? Math.min(duration, position + seconds) : position + seconds);
      engine.seek(pos);
      set({ position: pos });
    },

    toggleShuffle: () => {
      const { shuffle, queue, baseQueue, index } = get();
      const current = queue[index];
      if (!shuffle) {
        if (!current) return set({ shuffle: true });
        const rest = shuffled(queue.filter((_, i) => i !== index));
        set({ shuffle: true, baseQueue: queue, queue: [current, ...rest], index: 0 });
      } else {
        const at = current ? baseQueue.indexOf(current) : -1;
        set({ shuffle: false, queue: baseQueue, index: at >= 0 ? at : Math.min(index, baseQueue.length - 1) });
      }
    },

    cycleRepeat: () => {
      const order: RepeatMode[] = ["off", "all", "one"];
      set({ repeat: order[(order.indexOf(get().repeat) + 1) % order.length] });
    },

    enqueue: (track) => {
      const item = toPlayerTrack(track);
      if (!item) return;
      const { queue, baseQueue } = get();
      set({ queue: [...queue, item], baseQueue: [...baseQueue, item] });
      if (queue.length === 0) open(0, false);
    },

    playNext: (track) => {
      const item = toPlayerTrack(track);
      if (!item) return;
      const { queue, baseQueue, index } = get();
      if (queue.length === 0) {
        set({ queue: [item], baseQueue: [item] });
        return open(0, false);
      }
      const nq = [...queue];
      nq.splice(index + 1, 0, item);
      set({ queue: nq, baseQueue: [...baseQueue, item] });
    },

    removeAt: (i) => {
      const { queue, baseQueue, index, playing } = get();
      const item = queue[i];
      if (!item) return;
      const nq = queue.filter((_, k) => k !== i);
      const nb = baseQueue.filter((x) => x !== item);
      if (i < index) return set({ queue: nq, baseQueue: nb, index: index - 1 });
      if (i > index) return set({ queue: nq, baseQueue: nb });
      // Removing the current track.
      set({ queue: nq, baseQueue: nb });
      if (nq.length === 0) {
        engine.unload();
        set({ index: -1, playing: false, position: 0, duration: 0, error: false });
      } else {
        open(Math.min(i, nq.length - 1), playing);
      }
    },

    move: (from, to) => {
      const { queue, index, shuffle } = get();
      if (from === to || from < 0 || to < 0 || from >= queue.length || to >= queue.length) return;
      const nq = [...queue];
      const [item] = nq.splice(from, 1);
      nq.splice(to, 0, item);
      let ni = index;
      if (from === index) ni = to;
      else if (from < index && to >= index) ni = index - 1;
      else if (from > index && to <= index) ni = index + 1;
      set(shuffle ? { queue: nq, index: ni } : { queue: nq, baseQueue: nq, index: ni });
    },

    clearQueue: () => {
      const current = selectCurrent(get());
      set(current ? { queue: [current], baseQueue: [current], index: 0 } : { queue: [], baseQueue: [], index: -1 });
    },

    toggleQueue: () => set({ queueOpen: !get().queueOpen }),
    setQueueOpen: (open) => set({ queueOpen: open }),

    updateTrack: (track) => {
      const info = toPlayerTrack(track);
      if (!info) return;
      // One new object per old object: `queue` and `baseQueue` keep sharing references,
      // and duplicates of the same track stay distinct entries.
      const swapped = new Map<PlayerTrack, PlayerTrack>();
      const swap = (item: PlayerTrack): PlayerTrack => {
        if (item.id !== track.id) return item;
        let next = swapped.get(item);
        if (!next) {
          next = { ...info };
          swapped.set(item, next);
        }
        return next;
      };
      const { queue, baseQueue, coverRev } = get();
      set({ queue: queue.map(swap), baseQueue: baseQueue.map(swap), coverRev: coverRev + 1 });
    },

    removeTrackById: (id) => {
      for (let i = get().queue.length - 1; i >= 0; i--) {
        if (get().queue[i].id === id) get().removeAt(i);
      }
    },

    _tick: (position, duration) => set((s) => ({ position, duration: duration > 0 ? duration : s.duration })),
    _setPlaying: (playing) => set({ playing }),
    _started: () => {
      failures = 0;
    },
    _ended: () => {
      if (get().repeat === "one") {
        engine.seek(0);
        get().play();
      } else {
        advance(true);
      }
    },
    _failed: () => {
      const { index, queue } = get();
      if (!queue[index]) return; // unload() can raise a spurious error
      failures += 1;
      set({ playing: false, error: true });
      if (failures < queue.length && index + 1 < queue.length) open(index + 1);
    },
  };
});