import { useTranslation } from "react-i18next";
import { removeFromPlaylist, revealTrack } from "../ipc/commands";
import { useErrorText } from "../lib/useErrorText";
import { useLibraryStore } from "../state/libraryStore";
import { usePlayerStore } from "../state/playerStore";
import { usePlaylistMenuStore } from "../state/playlistMenuStore";
import { useTrackMenuStore } from "../state/trackMenuStore";
import { MenuItem, MenuSeparator, MenuShell } from "./MenuShell";

export function TrackContextMenu() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const menu = useTrackMenuStore((s) => s.menu);
  const track = useLibraryStore((s) =>
    menu ? s.tracks.find((x) => x.id === menu.trackId) : undefined,
  );
  if (!menu || !track) return null;

  const store = useTrackMenuStore.getState();
  const playlistId = menu.playlistId;
  const playable = track.status === "done" && track.filePath !== null;
  const hasFile = track.filePath !== null;
  const run = (fn: () => void) => () => {
    store.closeMenu();
    fn();
  };

  return (
    <MenuShell x={menu.x} y={menu.y} label={t("menu.label")} onClose={store.closeMenu}>
      <MenuItem
        disabled={!playable}
        onClick={run(() => usePlayerStore.getState().playTracks([track], track.id))}
      >
        {t("menu.play")}
      </MenuItem>
      <MenuItem disabled={!playable} onClick={run(() => usePlayerStore.getState().playNext(track))}>
        {t("menu.playNext")}
      </MenuItem>
      <MenuItem disabled={!playable} onClick={run(() => usePlayerStore.getState().enqueue(track))}>
        {t("menu.enqueue")}
      </MenuItem>
      <MenuSeparator />
      <MenuItem onClick={run(() => store.openEdit(track.id))}>{t("menu.edit")}</MenuItem>
      <MenuItem
        disabled={!hasFile}
        onClick={run(() => {
          void revealTrack(track.id).catch((e) => store.notify(errorText(e)));
        })}
      >
        {t("menu.reveal")}
      </MenuItem>
      <MenuSeparator />
      <MenuItem onClick={run(() => usePlaylistMenuStore.getState().openAddTo(track.id))}>
        {t("menu.addToPlaylist")}
      </MenuItem>
      {playlistId !== null && (
        <MenuItem
          onClick={run(() => {
            void removeFromPlaylist(playlistId, track.id)
              .then(() => useLibraryStore.getState().refreshPlaylists())
              .catch((e) => store.notify(errorText(e)));
          })}
        >
          {t("menu.removeFromPlaylist")}
        </MenuItem>
      )}
      <MenuSeparator />
      <MenuItem onClick={run(() => store.openDelete(track.id))}>
        {playlistId !== null ? t("menu.deleteFromLibrary") : t("menu.delete")}
      </MenuItem>
    </MenuShell>
  );
}