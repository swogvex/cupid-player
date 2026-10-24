import { useMemo, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Marquee } from "../components/Marquee";
import { PixelButton } from "../components/PixelButton";
import { Sprite } from "../components/Sprite";
import { TrackMenus } from "../components/TrackMenus";
import { VirtualTrackList } from "../components/VirtualTrackList";
import { tracksOfPlaylist } from "../lib/playlists";
import { useLibraryStore } from "../state/libraryStore";
import { useNavStore } from "../state/navStore";
import { usePlayerStore } from "../state/playerStore";
import { usePlaylistMenuStore } from "../state/playlistMenuStore";

export function PlaylistsView() {
  const { t } = useTranslation();
  const openId = useNavStore((s) => s.openPlaylistId);
  const openPlaylist = useNavStore((s) => s.openPlaylist);
  const playlists = useLibraryStore((s) => s.playlists);
  const tracks = useLibraryStore((s) => s.tracks);
  const members = useLibraryStore((s) => s.members);
  const error = useLibraryStore((s) => s.error);
  const playlist = playlists.find((p) => p.id === openId);
  const openedId = playlist?.id;

  const playlistTracks = useMemo(
    () => (openedId === undefined ? [] : tracksOfPlaylist(tracks, members, openedId)),
    [tracks, members, openedId],
  );

  // Right click on empty space: `playlistId` null = the list, otherwise that playlist.
  const openMenu = (e: MouseEvent<HTMLElement>, playlistId: number | null) => {
    e.preventDefault();
    e.stopPropagation();
    usePlaylistMenuStore.getState().openMenu(e.clientX, e.clientY, playlistId);
  };

  const body = playlist ? (
    <section
      className="view"
      aria-labelledby="view-playlist"
      onContextMenu={(e) => openMenu(e, playlist.id)}
    >
      <header className="view__head view__head--back" data-marquee-host>
        <PixelButton variant="mini" aria-label={t("common.back")} onClick={() => openPlaylist(null)}>
          <Sprite name="icon-back" w={7} h={7} />
        </PixelButton>
        <h2 id="view-playlist" className="view__title ellipsis">
          <Marquee text={playlist.name} always />
        </h2>
      </header>
      {error ? (
        <p className="muted">{error}</p>
      ) : playlistTracks.length === 0 ? (
        <div className="view__empty">
          <p className="muted">{t("playlists.emptyPlaylist")}</p>
          <PixelButton onClick={() => usePlaylistMenuStore.getState().openPicker(playlist.id)}>
            {t("playlists.addSongs")}
          </PixelButton>
        </div>
      ) : (
        <VirtualTrackList
          tracks={playlistTracks}
          playlistId={playlist.id}
          onPlay={(picked) => usePlayerStore.getState().playTracks(playlistTracks, picked.id)}
        />
      )}
    </section>
  ) : (
    <section
      className="view"
      aria-labelledby="view-playlists"
      onContextMenu={(e) => openMenu(e, null)}
    >
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
              data-marquee-host
              onClick={() => openPlaylist(p.id)}
              onContextMenu={(e) => openMenu(e, p.id)}
            >
              <Marquee className="card-text" text={p.name} />
              <span className="card-text muted">{t("playlists.tracks", { count: p.trackCount })}</span>
            </PixelButton>
          ))}
        </div>
      )}
    </section>
  );

  return (
    <>
      {body}
      <TrackMenus />
    </>
  );
}