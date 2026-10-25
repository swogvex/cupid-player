import { create } from "zustand";
import { load, type Store } from "@tauri-apps/plugin-store";
import { setAlwaysOnTop, setCloseToTray } from "../ipc/commands";
import { isLanguage, setLanguage as applyLanguage, type Language } from "../i18n";
import { applyTheme, initialTheme, isTheme, type ThemeId } from "../lib/theme";

export type { Language };

type SettingsState = {
  ready: boolean;
  alwaysOnTop: boolean;
  closeToTray: boolean;
  language: Language;
  theme: ThemeId;
  /** 0..1. The audio engine (H6) plays at `muted ? 0 : volume`. */
  volume: number;
  muted: boolean;
  init: () => Promise<void>;
  setAlwaysOnTop: (value: boolean) => Promise<void>;
  setCloseToTray: (value: boolean) => Promise<void>;
  setLanguage: (lang: Language) => Promise<void>;
  setTheme: (id: ThemeId) => Promise<void>;
  setVolume: (value: number) => void;
  toggleMuted: () => void;
};

const DEFAULTS = {
  alwaysOnTop: false,
  closeToTray: false,
  language: "es" as Language,
  theme: initialTheme(),
  volume: 0.5,
  muted: false,
};

let store: Store | null = null;
let initPromise: Promise<void> | null = null;
let volumeTimer: number | undefined;

const asBool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
const asLang = (v: unknown): Language => (isLanguage(v) ? v : DEFAULTS.language);
const asTheme = (v: unknown): ThemeId => (isTheme(v) ? v : DEFAULTS.theme);
const asVolume = (v: unknown): number => (typeof v === "number" && v >= 0 && v <= 1 ? v : DEFAULTS.volume);
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

async function persist(key: string, value: unknown): Promise<void> {
  try {
    await store?.set(key, value);
    await store?.save();
  } catch (e) {
    console.error("settings: could not save", key, e);
  }
}

/** Dragging the slider changes the value many times a second: write to disk once it settles. */
function saveVolumeSoon(read: () => { volume: number; muted: boolean }): void {
  window.clearTimeout(volumeTimer);
  volumeTimer = window.setTimeout(() => {
    const { volume, muted } = read();
    void persist("volume", volume);
    void persist("muted", muted);
  }, 300);
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ready: false,
  ...DEFAULTS,

  init: () => {
    // Guard against React StrictMode running effects twice in dev.
    initPromise ??= (async () => {
      try {
        store = await load("settings.json", { defaults: {} });
        const alwaysOnTop = asBool(await store.get("alwaysOnTop"), DEFAULTS.alwaysOnTop);
        const closeToTray = asBool(await store.get("closeToTray"), DEFAULTS.closeToTray);
        const language = asLang(await store.get("language"));
        const theme = asTheme(await store.get("theme"));
        const volume = asVolume(await store.get("volume"));
        const muted = asBool(await store.get("muted"), DEFAULTS.muted);
        set({ alwaysOnTop, closeToTray, language, theme, volume, muted });
        applyTheme(theme);
        await applyLanguage(language);
        await setAlwaysOnTop(alwaysOnTop);
        await setCloseToTray(closeToTray);
      } catch (e) {
        console.error("settings: init failed, using defaults", e);
      } finally {
        set({ ready: true });
      }
    })();
    return initPromise;
  },

  setAlwaysOnTop: async (value) => {
    set({ alwaysOnTop: value });
    await persist("alwaysOnTop", value);
    try {
      await setAlwaysOnTop(value);
    } catch (e) {
      console.error("settings: could not set always-on-top", e);
    }
  },

  setCloseToTray: async (value) => {
    set({ closeToTray: value });
    await persist("closeToTray", value);
    try {
      await setCloseToTray(value);
    } catch (e) {
      console.error("settings: could not set close-to-tray", e);
    }
  },

  setLanguage: async (lang) => {
    set({ language: lang });
    await applyLanguage(lang);
    await persist("language", lang);
  },

  setTheme: async (id) => {
    set({ theme: id });
    applyTheme(id);
    await persist("theme", id);
  },

  setVolume: (value) => {
    set({ volume: clamp01(value), muted: false });
    saveVolumeSoon(get);
  },

  toggleMuted: () => {
    const { muted, volume } = get();
    if (muted || volume === 0) set({ muted: false, volume: volume === 0 ? 0.5 : volume });
    else set({ muted: true });
    saveVolumeSoon(get);
  },
}));