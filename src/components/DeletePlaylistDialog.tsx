import { useState } from "react";
import { useTranslation } from "react-i18next";
import { deletePlaylist } from "../ipc/commands";
import type { Playlist } from "../ipc/types";
import { useErrorText } from "../lib/useErrorText";
import { useLibraryStore } from "../state/libraryStore";
import { useNavStore } from "../state/navStore";
import { usePlaylistMenuStore } from "../state/playlistMenuStore";
import { Modal } from "./Modal";
import { Overlay } from "./Overlay";
import { PixelButton } from "./PixelButton";

export function DeletePlaylistDialog() {
  const id = usePlaylistMenuStore((s) => s.deletingId);
  const playlist = useLibraryStore((s) =>
    id === null ? undefined : s.playlists.find((p) => p.id === id),
  );
  if (!playlist) return null;
  return (
    <Overlay>
      <DeleteForm key={playlist.id} playlist={playlist} />
    </Overlay>
  );
}

function DeleteForm({ playlist }: { playlist: Playlist }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const close = usePlaylistMenuStore((s) => s.closeDelete);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await deletePlaylist(playlist.id);
      // Leave the playlist's page before it disappears from the store.
      if (useNavStore.getState().openPlaylistId === playlist.id) {
        useNavStore.getState().openPlaylist(null);
      }
      await useLibraryStore.getState().refreshPlaylists();
      close();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      titleId="playlist-delete-title"
      onClose={() => {
        if (!busy) close();
      }}
    >
      <h3 id="playlist-delete-title" className="modal__title">
        {t("playlistDelete.title")}
      </h3>
      <p className="modal__text">{t("playlistDelete.message", { name: playlist.name })}</p>
      {error && (
        <p className="modal__error" role="alert">
          {error}
        </p>
      )}
      <div className="modal__actions">
        <PixelButton data-autofocus disabled={busy} onClick={close}>
          {t("playlistDelete.cancel")}
        </PixelButton>
        <PixelButton active disabled={busy} onClick={() => void run()}>
          {t("playlistDelete.confirm")}
        </PixelButton>
      </div>
    </Modal>
  );
}