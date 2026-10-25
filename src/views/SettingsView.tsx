import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PixelButton } from "../components/PixelButton";
import { LANGUAGES, type Language } from "../i18n";
import {
  clearCache,
  getCacheInfo,
  openMusicFolder,
  scanFolder,
} from "../ipc/commands";
import type { CacheInfo, ScanReport } from "../ipc/types";
import { formatBytes } from "../lib/bytes";
import { THEMES } from "../lib/theme";
import { useErrorText } from "../lib/useErrorText";
import { useImportStore } from "../state/importStore";
import { useLibraryStore } from "../state/libraryStore";
import { useSettingsStore } from "../state/settingsStore";

const LANGUAGE_NAMES: Record<Language, string> = {
  es: "Español",
  en: "English",
};

export function SettingsView() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const language = useSettingsStore((s) => s.language);
  const alwaysOnTop = useSettingsStore((s) => s.alwaysOnTop);
  const theme = useSettingsStore((s) => s.theme);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const setAlwaysOnTop = useSettingsStore((s) => s.setAlwaysOnTop);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const importing = useImportStore(
    (s) => s.phase === "starting" || s.phase === "running",
  );
  const closeToTray = useSettingsStore((s) => s.closeToTray);
  const setCloseToTray = useSettingsStore((s) => s.setCloseToTray);

  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [folderMessage, setFolderMessage] = useState<string | null>(null);
  const [cache, setCache] = useState<CacheInfo | null>(null);
  const [clearing, setClearing] = useState(false);
  const [cacheMessage, setCacheMessage] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void getCacheInfo()
      .then((info) => {
        if (alive) setCache(info);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const describe = (r: ScanReport): string => {
    if (r.found === 0) return t("scan.none");
    const parts = [t("scan.added", { count: r.added })];
    if (r.duplicates > 0)
      parts.push(t("scan.duplicates", { count: r.duplicates }));
    if (r.failed > 0) parts.push(t("scan.failed", { count: r.failed }));
    if (r.truncated) parts.push(t("scan.truncated"));
    return parts.join(" · ");
  };

  const importFolder = async () => {
    setScanning(true);
    setScanMessage(null);
    try {
      const report = await scanFolder();
      if (report) {
        await useLibraryStore.getState().load();
        setScanMessage(describe(report));
      }
    } catch (e) {
      setScanMessage(errorText(e));
    } finally {
      setScanning(false);
    }
  };

  const openFolder = () => {
    setFolderMessage(null);
    void openMusicFolder().catch((e) => setFolderMessage(errorText(e)));
  };

  const clear = async () => {
    setClearing(true);
    setCacheMessage(null);
    try {
      const result = await clearCache();
      setCacheMessage(
        result.removed === 0
          ? t("cache.nothing")
          : t("cache.cleared", {
              count: result.removed,
              size: formatBytes(result.freedBytes),
            }),
      );
      setCache(await getCacheInfo());
    } catch (e) {
      setCacheMessage(errorText(e));
    } finally {
      setClearing(false);
    }
  };

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
          <div
            className="btn-group"
            role="group"
            aria-label={t("settings.language")}
          >
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

        <div className="setting setting--stack">
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
          <span className="muted">{t("settings.alwaysOnTopHint")}</span>
        </div>

        <div className="setting setting--stack">
          <div className="setting">
            <span>{t("settings.closeToTray")}</span>
            <PixelButton
              active={closeToTray}
              aria-pressed={closeToTray}
              onClick={() => void setCloseToTray(!closeToTray)}
            >
              {closeToTray ? t("common.on") : t("common.off")}
            </PixelButton>
          </div>
          <span className="muted">{t("settings.closeToTrayHint")}</span>
        </div>

        <div className="setting setting--stack">
          <div className="setting">
            <span>{t("settings.musicFolder")}</span>
            <PixelButton onClick={openFolder}>
              {t("settings.openFolder")}
            </PixelButton>
          </div>
          {folderMessage && <span role="alert">{folderMessage}</span>}
        </div>

        <div className="setting setting--stack">
          <div className="setting">
            <span>{t("settings.importFolder")}</span>
            <PixelButton
              disabled={scanning || importing}
              onClick={() => void importFolder()}
            >
              {scanning ? t("scan.running") : t("settings.chooseFolder")}
            </PixelButton>
          </div>
          <span className="muted">{t("settings.importFolderHint")}</span>
          {scanMessage && (
            <span role="status" aria-live="polite">
              {scanMessage}
            </span>
          )}
        </div>

        <div className="setting setting--stack">
          <div className="setting">
            <span>{t("settings.cache")}</span>
            <PixelButton
              disabled={
                clearing || importing || !cache || cache.reclaimableCount === 0
              }
              onClick={() => void clear()}
            >
              {t("settings.clearCache")}
            </PixelButton>
          </div>
          {cache && (
            <span className="muted">
              {t("cache.summary", {
                covers: formatBytes(cache.coversBytes),
                free: formatBytes(cache.reclaimableBytes),
              })}
            </span>
          )}
          <span className="muted">{t("settings.cacheHint")}</span>
          {cacheMessage && (
            <span role="status" aria-live="polite">
              {cacheMessage}
            </span>
          )}
        </div>

        <div className="setting setting--stack">
          <span>{t("settings.theme")}</span>
          <div
            className="theme-grid"
            role="group"
            aria-label={t("settings.theme")}
          >
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
                    <i
                      key={`${th.id}-${i}`}
                      className="swatch"
                      style={{ background: color }}
                    />
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
