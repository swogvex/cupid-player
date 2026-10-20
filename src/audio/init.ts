import { useSettingsStore } from "../state/settingsStore";
import { usePlayerStore } from "../state/playerStore";
import * as engine from "./engine";
import { initMediaSession } from "./mediaSession";
import { initShortcuts } from "./shortcuts";

/** Connects engine ⇄ stores. Call once from App; returns the cleanup (safe under StrictMode). */
export function initAudio(): () => void {
  const player = () => usePlayerStore.getState();

  // Volume: the engine plays at `muted ? 0 : volume`.
  const applyVolume = (s: { volume: number; muted: boolean }) => engine.setVolume(s.muted ? 0 : s.volume);
  applyVolume(useSettingsStore.getState());
  const offVolume = useSettingsStore.subscribe(applyVolume);

  const offEngine = engine.subscribe({
    time: (pos, dur) => player()._tick(pos, dur),
    state: (playing) => player()._setPlaying(playing),
    started: () => player()._started(),
    ended: () => player()._ended(),
    error: () => player()._failed(),
  });

  const offMedia = initMediaSession();
  const offKeys = initShortcuts();

  return () => {
    offVolume();
    offEngine();
    offMedia();
    offKeys();
  };
}