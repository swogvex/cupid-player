import { useState } from "react";
import { useTranslation } from "react-i18next";
import { addToPlaylist } from "../ipc/commands";
import type { Track } from "../ipc/types";
import { useErrorText } from "../lib/useErrorText";
import { useLibraryStore } from "../state/libraryStore";
import { usePlaylistMenuStore } from "../state/playlistMenuStore";
import { Marquee } from "./Marquee";
import { Modal } from "./Modal";
import { Overlay } from "./Overlay";
import { PixelButton } from "./PixelButton";

export function AddToPlaylistDialog() {
  const id = usePlaylistMenuStore((s) => s.addingTrackId);
  const track = useLibraryStore((s) => (id === null ? undefined : s.tracks.find((x) => x.id === id)));
  if (!track) return null;
  return (
    <Overlay>
      <AddForm key={track.id} track={track} />
    </Overlay>
  );
}

function AddForm({ track }: { track: Track }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const close = usePlaylistMenuStore((s) => s.closeAddTo);
  const playlists = useLibraryStore((s) => s.playlists);
  const members = useLibraryStore((s) => s.members);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addTo = async (playlistId: number) => {
    setBusy(true);
    setError(null);
    try {
      await addToPlaylist(playlistId, [track.id]);
      await useLibraryStore.getState().refreshPlaylists();
      close();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  const createNew = () => {
    const store = usePlaylistMenuStore.getState();
    store.closeAddTo();
    store.openName({ mode: "create", addTrackId: track.id });
  };

  return (
    <Modal
      titleId="add-to-title"
      onClose={() => {
        if (!busy) close();
      }}
    >
      <h3 id="add-to-title" className="modal__title">
        {t("addTo.title")}
      </h3>
      <Marquee className="muted" text={track.title} always />

      <div className="modal__list">
        <button type="button" className="ctx__item pl-item" disabled={busy} onClick={createNew}>
          <span className="ellipsis">{t("addTo.new")}</span>
        </button>
        {playlists.length === 0 && <p className="muted picker__empty">{t("addTo.none")}</p>}
        {playlists.map((p) => {
          const already = members[p.id]?.includes(track.id) ?? false;
          return (
            <button
              key={p.id}
              type="button"
              className="ctx__item pl-item"
              disabled={busy || already}
              onClick={() => void addTo(p.id)}
            >
              <span className="ellipsis">{p.name}</span>
              <span className="muted">
                {already ? t("addTo.already") : t("playlists.tracks", { count: p.trackCount })}
              </span>
            </button>
          );
        })}
      </div>

      {error && (
        <p className="modal__error" role="alert">
          {error}
        </p>
      )}
      <div className="modal__actions">
        <PixelButton data-autofocus disabled={busy} onClick={close}>
          {t("addTo.cancel")}
        </PixelButton>
      </div>
    </Modal>
  );
}