import { startPlay, updatePlay } from "../ipc/commands";
import { selectCurrent, usePlayerStore } from "../state/playerStore";
import * as engine from "./engine";
import { CHECKPOINT_MS, createListenCounter } from "./listenCounter";

const noop = () => undefined;

/**
 * Feeds the listen counter from the engine (audio position, end of song) and the player
 * store (current track, playing). Returns the cleanup (safe under StrictMode).
 */
export function initListenTracker(): () => void {
  const counter = createListenCounter({ startPlay, updatePlay });
  const state = () => usePlayerStore.getState();

  counter.setTrack(selectCurrent(state())?.id ?? null);
  counter.setPlaying(state().playing);

  // A single store update can change both; the track goes first so a new song never
  // inherits the previous one's session.
  const offStore = usePlayerStore.subscribe((s, prev) => {
    const id = selectCurrent(s)?.id ?? null;
    if (id !== (selectCurrent(prev)?.id ?? null)) counter.setTrack(id);
    if (s.playing !== prev.playing) counter.setPlaying(s.playing);
  });

  const offEngine = engine.subscribe({
    time: (position) => counter.tick(position),
    state: noop,
    started: noop,
    ended: () => counter.finish(),
    error: noop,
  });

  const timer = window.setInterval(() => counter.checkpoint(), CHECKPOINT_MS);

  // Best effort when the window closes: whatever was heard so far is sent.
  const flush = () => counter.finish();
  window.addEventListener("pagehide", flush);
  window.addEventListener("beforeunload", flush);

  return () => {
    window.removeEventListener("pagehide", flush);
    window.removeEventListener("beforeunload", flush);
    window.clearInterval(timer);
    offEngine();
    offStore();
    counter.finish();
  };
}