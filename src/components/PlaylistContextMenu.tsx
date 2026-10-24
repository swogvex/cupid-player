import { useTranslation } from "react-i18next";
import { revealPlaylist } from "../ipc/commands";
import { tracksOfPlaylist } from "../lib/playlists";
import { useErrorText } from "../lib/useErrorText";
import { useLibraryStore } from "../state/libraryStore";
import { usePlayerStore } from "../state/playerStore";
import { usePlaylistMenuStore } from "../state/playlistMenuStore";
import { useTrackMenuStore } from "../state/trackMenuStore";
import { MenuItem, MenuSeparator, MenuShell } from "./MenuShell";

export function PlaylistContextMenu() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const menu = usePlaylistMenuStore((s) => s.menu);
  const playlist = useLibraryStore((s) =>
    menu === null || menu.playlistId === null
      ? undefined
      : s.playlists.find((p) => p.id === menu.playlistId),
  );
  const tracks = useLibraryStore((s) => s.tracks);
  const members = useLibraryStore((s) => s.members);
  if (!menu) return null;

  const store = usePlaylistMenuStore.getState();
  const run = (fn: () => void) => () => {
    store.closeMenu();
    fn();
  };

  // Empty area of the playlists list.
  if (menu.playlistId === null) {
    return (
      <MenuShell x={menu.x} y={menu.y} label={t("playlistMenu.label")} onClose={store.closeMenu}>
        <MenuItem onClick={run(() => store.openName({ mode: "create" }))}>
          {t("playlistMenu.new")}
        </MenuItem>
      </MenuShell>
    );
  }

  if (!playlist) return null;
  const playable = tracksOfPlaylist(tracks, members, playlist.id).filter(
    (tr) => tr.status === "done" && tr.filePath !== null,
  );

  return (
    <MenuShell x={menu.x} y={menu.y} label={t("playlistMenu.label")} onClose={store.closeMenu}>
      <MenuItem
        disabled={playable.length === 0}
        onClick={run(() => usePlayerStore.getState().playTracks(playable))}
      >
        {t("playlistMenu.play")}
      </MenuItem>
      <MenuItem
        disabled={playable.length === 0}
        onClick={run(() => playable.forEach((tr) => usePlayerStore.getState().enqueue(tr)))}
      >
        {t("playlistMenu.enqueue")}
      </MenuItem>
      <MenuSeparator />
      <MenuItem onClick={run(() => store.openPicker(playlist.id))}>{t("playlistMenu.addSongs")}</MenuItem>
      <MenuItem onClick={run(() => store.openName({ mode: "rename", playlistId: playlist.id }))}>
        {t("playlistMenu.rename")}
      </MenuItem>
      <MenuItem
        disabled={playlist.folder === ""}
        onClick={run(() => {
          void revealPlaylist(playlist.id).catch((e) =>
            useTrackMenuStore.getState().notify(errorText(e)),
          );
        })}
      >
        {t("playlistMenu.reveal")}
      </MenuItem>
      <MenuSeparator />
      <MenuItem onClick={run(() => store.openDelete(playlist.id))}>{t("playlistMenu.delete")}</MenuItem>
    </MenuShell>
  );
}