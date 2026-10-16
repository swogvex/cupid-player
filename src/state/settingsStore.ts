import { create } from "zustand";
import { load, type Store } from "@tauri-apps/plugin-store";
import { setAlwaysOnTop, setWindowScale } from "../ipc/commands";
import type { Scale } from "../lib/scale";

export type Language = "es" | "en";

type SettingsState = {
  ready: boolean;
  scale: Scale;
  alwaysOnTop: boolean;
  language: Language;
  init: () => Promise<void>;
  setScale: (n: Scale) => Promise<void>;
  setAlwaysOnTop: (value: boolean) => Promise<void>;
  setLanguage: (lang: Language) => Promise<void>;
};

const DEFAULTS = { scale: 2 as Scale, alwaysOnTop: false, language: "es" as Language };

let store: Store | null = null;
let initPromise: Promise<void> | null = null;

const asScale = (v: unknown): Scale => (v === 2 || v === 3 || v === 4 ? v : DEFAULTS.scale);
const asBool = (v: unknown): boolean => (typeof v === "boolean" ? v : DEFAULTS.alwaysOnTop);
const asLang = (v: unknown): Language => (v === "es" || v === "en" ? v : DEFAULTS.language);

async function persist(key: string, value: unknown): Promise<void> {
  try {
    await store?.set(key, value);
    await store?.save();
  } catch (e) {
    console.error("settings: could not save", key, e);
  }
}

export const useSettingsStore = create<SettingsState>((set) => ({
  ready: false,
  ...DEFAULTS,

  init: () => {
    // Guard against React StrictMode running effects twice in dev.
    initPromise ??= (async () => {
      try {
        store = await load("settings.json", { defaults: {} });
        const scale = asScale(await store.get("scale"));
        const alwaysOnTop = asBool(await store.get("alwaysOnTop"));
        const language = asLang(await store.get("language"));
        set({ scale, alwaysOnTop, language });
        await setWindowScale(scale);
        await setAlwaysOnTop(alwaysOnTop);
      } catch (e) {
        console.error("settings: init failed, using defaults", e);
      } finally {
        set({ ready: true });
      }
    })();
    return initPromise;
  },

  setScale: async (n) => {
    set({ scale: n });
    await persist("scale", n);
    try {
      await setWindowScale(n);
    } catch (e) {
      console.error("settings: could not resize window", e);
    }
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

  setLanguage: async (lang) => {
    set({ language: lang });
    await persist("language", lang);
  },
}));