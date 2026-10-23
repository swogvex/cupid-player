import { useTranslation } from "react-i18next";
import { PixelButton } from "../components/PixelButton";
import { Sprite } from "../components/Sprite";
import { TrackMenus } from "../components/TrackMenus";
import { TrackRow } from "../components/TrackRow";
import { useLibraryStore } from "../state/libraryStore";
import { useNavStore } from "../state/navStore";
import { usePlayerStore } from "../state/playerStore";

export function PlaylistsView() {
  const { t } = useTranslation();
  const openId = useNavStore((s) => s.openPlaylistId);
  const openPlaylist = useNavStore((s) => s.openPlaylist);
  const playlists = useLibraryStore((s) => s.playlists);
  const tracks = useLibraryStore((s) => s.tracks);
  const error = useLibraryStore((s) => s.error);
  const playlist = playlists.find((p) => p.id === openId);

  if (playlist) {
    const playlistTracks = tracks.filter((tr) => tr.playlistId === playlist.id);
    return (
      <section className="view" aria-labelledby="view-playlist">
        <header className="view__head view__head--back">
          <PixelButton
            variant="mini"
            aria-label={t("common.back")}
            onClick={() => openPlaylist(null)}
          >
            <Sprite name="icon-back" w={7} h={7} />
          </PixelButton>
          <h2 id="view-playlist" className="view__title ellipsis">
            {playlist.name}
          </h2>
        </header>
        {error ? (
          <p className="muted">{error}</p>
        ) : (
          <ul className="list view__scroll">
            {playlistTracks.map((tr) => (
              <TrackRow
                key={tr.id}
                track={tr}
                onPlay={(picked) =>
                  usePlayerStore.getState().playTracks(playlistTracks, picked.id)
                }
              />
            ))}
          </ul>
        )}
        <TrackMenus />
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
      {error ? (
        <p className="muted">{error}</p>
      ) : playlists.length === 0 ? (
        <p className="muted">{t("playlists.empty")}</p>
      ) : (
        <div className="cards view__scroll">
          {playlists.map((p) => (
            <PixelButton
              key={p.id}
              variant="nav"
              onClick={() => openPlaylist(p.id)}
            >
              <span className="card-text ellipsis">{p.name}</span>
              <span className="card-text muted">
                {t("playlists.tracks", { count: p.trackCount })}
              </span>
            </PixelButton>
          ))}
        </div>
      )}
    </section>
  );
}