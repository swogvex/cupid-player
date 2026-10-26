import { setWindowBackground } from "../ipc/commands";
import { THEMES, type ThemeId } from "./themes.generated";

export { THEMES };
export type { ThemeId };

export const DEFAULT_THEME: ThemeId = "pink";
const STORAGE_KEY = "cupid-theme";

export function isTheme(value: unknown): value is ThemeId {
  return THEMES.some((t) => t.id === value);
}

/**
 * Paints the native window background with the theme's --bg. While WebView2 repaints
 * during a resize, the exposed strip shows this colour instead of black.
 */
function syncWindowBackground(): void {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  const match = /^#([0-9a-f]{6})$/i.exec(raw);
  if (!match) return;
  const n = parseInt(match[1], 16);
  try {
    setWindowBackground([(n >> 16) & 255, (n >> 8) & 255, n & 255]).catch(() => {
      /* not critical: the strip just keeps the default colour */
    });
  } catch {
    /* not running inside Tauri (plain browser): nothing to do */
  }
}

/** Sets the theme on <html> (CSS tokens and sprite variables switch instantly). */
export function applyTheme(id: ThemeId): void {
  document.documentElement.dataset.theme = id;
  syncWindowBackground();
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* storage unavailable: the theme is still applied for this session */
  }
}

/** Last used theme, read synchronously so the first paint already has it. */
export function initialTheme(): ThemeId {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}