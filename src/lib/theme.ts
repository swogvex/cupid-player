import { THEMES, type ThemeId } from "./themes.generated";

export { THEMES };
export type { ThemeId };

export const DEFAULT_THEME: ThemeId = "pink";
const STORAGE_KEY = "cupid-theme";

export function isTheme(value: unknown): value is ThemeId {
  return THEMES.some((t) => t.id === value);
}

/** Sets the theme on <html> (CSS tokens and sprite variables switch instantly). */
export function applyTheme(id: ThemeId): void {
  document.documentElement.dataset.theme = id;
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