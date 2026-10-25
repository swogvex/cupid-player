import { useEffect, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { PixelPanel } from "./components/PixelPanel";
import { PlayerBar } from "./components/PlayerBar";
import { Sidebar } from "./components/Sidebar";
import { Sprite } from "./components/Sprite";
import { TitleBar } from "./components/TitleBar";
import { initAudio } from "./audio/init";
import { startScaleTracking } from "./lib/scale";
import { startVisibilityTracking } from "./lib/visibility";
import { useLibraryStore } from "./state/libraryStore";
import { useNavStore, type View } from "./state/navStore";
import { useSettingsStore } from "./state/settingsStore";
import { LibraryView } from "./views/LibraryView";
import { LyricsView } from "./views/LyricsView";
import { PlaylistsView } from "./views/PlaylistsView";
import { QueueView } from "./views/QueueView";
import { SettingsView } from "./views/SettingsView";
import { StatsView } from "./views/StatsView";
import "./styles/themeart.css";
import "./styles/lyrics.css";

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
  const lyricsOpen = useNavStore((s) => s.lyricsOpen);
  const toggleLyrics = useNavStore((s) => s.toggleLyrics);
  const ActiveView = VIEWS[view];

  useEffect(() => initAudio(), []);

  useEffect(() => {
    void init();
    const stopScale = startScaleTracking();
    const stopVisibility = startVisibilityTracking();
    return () => {
      stopScale();
      stopVisibility();
    };
  }, [init]);

  useEffect(() => {
    void useLibraryStore.getState().load();
  }, []);

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
            <PixelPanel className="content-panel" deco data-view={lyricsOpen ? "lyrics" : view}>
              {/* The heart opens the lyrics; Library/Playlists/Stats/Settings close them. */}
              <button
                type="button"
                className="heart-toggle"
                aria-label={t("lyrics.toggle")}
                title={t("lyrics.toggle")}
                aria-pressed={lyricsOpen}
                onClick={toggleLyrics}
              >
                <Sprite name="deco-heart" w={9} h={8} />
              </button>
              {lyricsOpen ? <LyricsView /> : <ActiveView />}
            </PixelPanel>
            <PlayerBar />
          </div>
        </div>
      </div>
      <QueueView />
    </div>
  );
}