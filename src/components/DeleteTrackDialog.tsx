import { useState } from "react";
import { useTranslation } from "react-i18next";
import { deleteTrack } from "../ipc/commands";
import type { Track } from "../ipc/types";
import { useErrorText } from "../lib/useErrorText";
import { useLibraryStore } from "../state/libraryStore";
import { usePlayerStore } from "../state/playerStore";
import { useTrackMenuStore } from "../state/trackMenuStore";
import { Modal } from "./Modal";
import { Overlay } from "./Overlay";
import { PixelButton } from "./PixelButton";

export function DeleteTrackDialog() {
  const id = useTrackMenuStore((s) => s.deletingId);
  const track = useLibraryStore((s) => (id === null ? undefined : s.tracks.find((x) => x.id === id)));
  if (!track) return null;
  return (
    <Overlay>
      <DeleteForm key={track.id} track={track} />
    </Overlay>
  );
}

function DeleteForm({ track }: { track: Track }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const close = useTrackMenuStore((s) => s.closeDelete);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasFile = track.filePath !== null;

  const run = async (deleteFile: boolean) => {
    setBusy(true);
    setError(null);
    try {
      // Out of the queue first: releases the file and avoids plays of a missing id.
      usePlayerStore.getState().removeTrackById(track.id);
      await deleteTrack(track.id, deleteFile);
      useLibraryStore.getState().removeTrack(track.id);
      void useLibraryStore.getState().load(); // refreshes playlist counters
      close();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Modal titleId="delete-title" onClose={close}>
      <h3 id="delete-title" className="modal__title">
        {t("delete.title")}
      </h3>
      <p className="modal__text">{t("delete.message", { title: track.title })}</p>
      {hasFile && <p className="modal__text muted">{t("delete.fileHint")}</p>}
      {error && (
        <p className="modal__error" role="alert">
          {error}
        </p>
      )}
      <div className="modal__actions">
        <PixelButton data-autofocus disabled={busy} onClick={close}>
          {t("delete.cancel")}
        </PixelButton>
        {hasFile ? (
          <>
            <PixelButton disabled={busy} onClick={() => void run(false)}>
              {t("delete.removeOnly")}
            </PixelButton>
            <PixelButton active disabled={busy} onClick={() => void run(true)}>
              {t("delete.removeFile")}
            </PixelButton>
          </>
        ) : (
          <PixelButton active disabled={busy} onClick={() => void run(false)}>
            {t("delete.remove")}
          </PixelButton>
        )}
      </div>
    </Modal>
  );
}