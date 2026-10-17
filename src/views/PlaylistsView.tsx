import { useTranslation } from "react-i18next";
import { PixelButton } from "../components/PixelButton";
import { Sprite } from "../components/Sprite";
import { TrackRow } from "../components/TrackRow";
import { mockPlaylists, mockTracks } from "../lib/mock";
import { useNavStore } from "../state/navStore";

export function PlaylistsView() {
  const { t } = useTranslation();
  const openId = useNavStore((s) => s.openPlaylistId);
  const openPlaylist = useNavStore((s) => s.openPlaylist);
  const playlist = mockPlaylists.find((p) => p.id === openId);

  if (playlist) {
    const tracks = mockTracks.filter((tr) => tr.playlistId === playlist.id);
    return (
      <section className="view" aria-labelledby="view-playlist">
        <header className="view__head view__head--back">
          <PixelButton variant="mini" aria-label={t("common.back")} onClick={() => openPlaylist(null)}>
            <Sprite name="icon-back" w={7} h={7} />
          </PixelButton>
          <h2 id="view-playlist" className="view__title ellipsis">
            {playlist.name}
          </h2>
        </header>
        <ul className="list view__scroll">
          {tracks.map((tr) => (
            <TrackRow key={tr.id} track={tr} />
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section className="view" aria-labelledby="view-playlists">
      <header className="view__head">
        <h2 id="view-playlists" className="view__title">
          {t("playlists.title")}
        </h2>
      </header>
      {mockPlaylists.length === 0 ? (
        <p className="muted">{t("playlists.empty")}</p>
      ) : (
        <div className="cards view__scroll">
          {mockPlaylists.map((p) => (
            <PixelButton key={p.id} variant="nav" onClick={() => openPlaylist(p.id)}>
              <span className="card-text ellipsis">{p.name}</span>
              <span className="card-text muted">{t("playlists.tracks", { count: p.trackCount })}</span>
            </PixelButton>
          ))}
        </div>
      )}
    </section>
  );
}