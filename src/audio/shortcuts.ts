import { useSettingsStore } from "../state/settingsStore";
import { usePlayerStore } from "../state/playerStore";

const INTERACTIVE = "input, textarea, select, button, a, [role='slider'], [contenteditable='true']";
const TEXT_FIELD = "input, textarea, select, [contenteditable='true']";

const matches = (target: EventTarget | null, selector: string): boolean =>
  target instanceof Element && target.closest(selector) !== null;

/** Space = play/pause, ←/→ = ∓5 s, Ctrl+↑/↓ = volume. */
export function initShortcuts(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.metaKey) return;

    if (e.ctrlKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      if (matches(e.target, TEXT_FIELD)) return;
      e.preventDefault();
      const { volume, muted, setVolume } = useSettingsStore.getState();
      setVolume((muted ? 0 : volume) + (e.key === "ArrowUp" ? 0.05 : -0.05));
      return;
    }

    // Sliders and buttons handle their own keys.
    if (e.ctrlKey || e.shiftKey || matches(e.target, INTERACTIVE)) return;
    const player = usePlayerStore.getState();
    if (e.code === "Space") {
      e.preventDefault();
      player.togglePlay();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      player.seekBy(5);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      player.seekBy(-5);
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}