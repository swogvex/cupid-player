import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { deletePlaylist } from "../ipc/commands";
import type { Playlist } from "../ipc/types";
import { useErrorText } from "../lib/useErrorText";
import { useImportStore } from "../state/importStore";
import { useLibraryStore } from "../state/libraryStore";
import { useNavStore } from "../state/navStore";
import { usePlayerStore } from "../state/playerStore";
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
  const importing = useImportStore((s) => s.phase === "starting" || s.phase === "running");
  const tracks = useLibraryStore((s) => s.tracks);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Songs imported together with this playlist (they live in its folder).
  const owned = useMemo(
    () => tracks.filter((tr) => tr.playlistId === playlist.id),
    [tracks, playlist.id],
  );
  const imported = playlist.folder !== "" && owned.length > 0;

  const run = async (deleteFiles: boolean) => {
    setBusy(true);
    setError(null);
    try {
      if (deleteFiles) {
        // Out of the queue first: releases the files and avoids plays of missing ids.
        for (const tr of owned) usePlayerStore.getState().removeTrackById(tr.id);
      }
      await deletePlaylist(playlist.id, deleteFiles);
      // Leave the playlist's page before it disappears from the store.
      if (useNavStore.getState().openPlaylistId === playlist.id) {
        useNavStore.getState().openPlaylist(null);
      }
      await useLibraryStore.getState().load();
      close();
    } catch (err) {
      void useLibraryStore.getState().load();
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
      {imported ? (
        <>
          <p className="modal__text">{t("playlistDelete.messageImported", { name: playlist.name })}</p>
          <p className="modal__text muted">{t("playlistDelete.hintKeep")}</p>
          <p className="modal__text muted">
            {t("playlistDelete.hintFiles", { count: owned.length })}
          </p>
        </>
      ) : (
        <p className="modal__text">{t("playlistDelete.message", { name: playlist.name })}</p>
      )}
      {error && (
        <p className="modal__error" role="alert">
          {error}
        </p>
      )}
      <div className="modal__actions">
        <PixelButton data-autofocus disabled={busy} onClick={close}>
          {t("playlistDelete.cancel")}
        </PixelButton>
        {imported ? (
          <>
            <PixelButton disabled={busy || importing} onClick={() => void run(false)}>
              {t("playlistDelete.keep")}
            </PixelButton>
            <PixelButton active disabled={busy || importing} onClick={() => void run(true)}>
              {t("playlistDelete.withFiles")}
            </PixelButton>
          </>
        ) : (
          <PixelButton active disabled={busy || importing} onClick={() => void run(false)}>
            {t("playlistDelete.confirm")}
          </PixelButton>
        )}
      </div>
    </Modal>
  );
}