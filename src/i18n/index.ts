import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import es from "./es.json";
import en from "./en.json";

export type Language = "es" | "en";

export const LANGUAGES: readonly Language[] = ["es", "en"];

export function isLanguage(value: unknown): value is Language {
  return value === "es" || value === "en";
}

void i18n.use(initReactI18next).init({
  resources: {
    es: { translation: es },
    en: { translation: en },
  },
  lng: "es",
  fallbackLng: "es",
  // React already escapes output; we never use dangerouslySetInnerHTML.
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

/** Changes the UI language instantly. Persistence lives in settingsStore. */
export function setLanguage(lang: Language): Promise<unknown> {
  return i18n.changeLanguage(lang);
}

export default i18n;