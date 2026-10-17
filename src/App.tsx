import { useEffect, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { PixelPanel } from "./components/PixelPanel";
import { PlayerBar } from "./components/PlayerBar";
import { Sidebar } from "./components/Sidebar";
import { Sprite } from "./components/Sprite";
import { TitleBar } from "./components/TitleBar";
import { startScaleTracking } from "./lib/scale";
import { useNavStore, type View } from "./state/navStore";
import { useSettingsStore } from "./state/settingsStore";
import { LibraryView } from "./views/LibraryView";
import { PlaylistsView } from "./views/PlaylistsView";
import { SettingsView } from "./views/SettingsView";
import { StatsView } from "./views/StatsView";

const VIEWS: Record<View, ComponentType> = {
  library: LibraryView,
  playlists: PlaylistsView,
  stats: StatsView,
  settings: SettingsView,
};

export default function App() {
  const { t } = useTranslation();
  const init = useSettingsStore((s) => s.init);
  const language = useSettingsStore((s) => s.language);
  const view = useNavStore((s) => s.view);
  const ActiveView = VIEWS[view];

  useEffect(() => {
    void init();
    return startScaleTracking();
  }, [init]);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return (
    <div className="letterbox">
      <div className="frame">
        <TitleBar />
        <div className="shell">
          <Sidebar />
          <div className="main-col">
            <PixelPanel className="content-panel" deco>
              {/* No action yet: the ambient view arrives in H10. */}
              <button type="button" className="heart-toggle" aria-label={t("ambient.toggle")}>
                <Sprite name="deco-heart" w={9} h={8} />
              </button>
              <ActiveView />
            </PixelPanel>
            <PlayerBar />
          </div>
        </div>
      </div>
    </div>
  );
}