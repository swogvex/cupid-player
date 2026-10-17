import { useTranslation } from "react-i18next";
import { PixelButton } from "../components/PixelButton";
import { LANGUAGES, type Language } from "../i18n";
import { THEMES } from "../lib/theme";
import { useSettingsStore } from "../state/settingsStore";

const LANGUAGE_NAMES: Record<Language, string> = { es: "Español", en: "English" };

export function SettingsView() {
  const { t } = useTranslation();
  const language = useSettingsStore((s) => s.language);
  const alwaysOnTop = useSettingsStore((s) => s.alwaysOnTop);
  const theme = useSettingsStore((s) => s.theme);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const setAlwaysOnTop = useSettingsStore((s) => s.setAlwaysOnTop);
  const setTheme = useSettingsStore((s) => s.setTheme);

  return (
    <section className="view" aria-labelledby="view-settings">
      <header className="view__head">
        <h2 id="view-settings" className="view__title">
          {t("settings.title")}
        </h2>
      </header>

      <div className="view__scroll settings-body">
        <div className="setting">
          <span>{t("settings.language")}</span>
          <div className="btn-group" role="group" aria-label={t("settings.language")}>
            {LANGUAGES.map((lang) => (
              <PixelButton
                key={lang}
                active={language === lang}
                aria-pressed={language === lang}
                onClick={() => void setLanguage(lang)}
              >
                {LANGUAGE_NAMES[lang]}
              </PixelButton>
            ))}
          </div>
        </div>

        <div className="setting">
          <span>{t("settings.alwaysOnTop")}</span>
          <PixelButton
            active={alwaysOnTop}
            aria-pressed={alwaysOnTop}
            onClick={() => void setAlwaysOnTop(!alwaysOnTop)}
          >
            {alwaysOnTop ? t("common.on") : t("common.off")}
          </PixelButton>
        </div>

        <div className="setting setting--stack">
          <span>{t("settings.theme")}</span>
          <div className="theme-grid" role="group" aria-label={t("settings.theme")}>
            {THEMES.map((th) => (
              <PixelButton
                key={th.id}
                className="theme-btn"
                active={theme === th.id}
                aria-pressed={theme === th.id}
                onClick={() => void setTheme(th.id)}
              >
                <span className="swatches" aria-hidden="true">
                  {th.swatches.map((color, i) => (
                    <i key={`${th.id}-${i}`} className="swatch" style={{ background: color }} />
                  ))}
                </span>
                <span className="ellipsis">{th.name}</span>
              </PixelButton>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}