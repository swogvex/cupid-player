import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { addToPlaylist, createPlaylist, renamePlaylist } from "../ipc/commands";
import { useErrorText } from "../lib/useErrorText";
import { useLibraryStore } from "../state/libraryStore";
import { useNavStore } from "../state/navStore";
import { usePlaylistMenuStore, type NameDialog } from "../state/playlistMenuStore";
import { Modal } from "./Modal";
import { Overlay } from "./Overlay";
import { PixelButton } from "./PixelButton";
import { PixelInput } from "./PixelInput";

const MAX_CHARS = 60;

export function PlaylistNameDialog() {
  const dialog = usePlaylistMenuStore((s) => s.nameDialog);
  const current = useLibraryStore((s) =>
    dialog?.mode === "rename" ? s.playlists.find((p) => p.id === dialog.playlistId) : undefined,
  );
  if (!dialog) return null;
  if (dialog.mode === "rename" && !current) return null;
  return (
    <Overlay>
      <NameForm
        key={dialog.mode === "rename" ? `rename-${dialog.playlistId}` : "create"}
        dialog={dialog}
        initial={current?.name ?? ""}
      />
    </Overlay>
  );
}

function NameForm({ dialog, initial }: { dialog: NameDialog; initial: string }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const close = usePlaylistMenuStore((s) => s.closeName);
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const creating = dialog.mode === "create";
  const valid = name.trim() !== "";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    if (dialog.mode === "rename" && name.trim() === initial) return close();
    setBusy(true);
    setError(null);
    try {
      if (dialog.mode === "create") {
        const created = await createPlaylist(name);
        if (dialog.addTrackId !== undefined) await addToPlaylist(created.id, [dialog.addTrackId]);
        await useLibraryStore.getState().refreshPlaylists();
        // Created from the Playlists view: open it so songs can be added right away.
        if (dialog.addTrackId === undefined) useNavStore.getState().openPlaylist(created.id);
      } else {
        await renamePlaylist(dialog.playlistId, name);
        await useLibraryStore.getState().refreshPlaylists();
      }
      close();
    } catch (err) {
      void useLibraryStore.getState().refreshPlaylists();
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      titleId="playlist-name-title"
      onClose={() => {
        if (!busy) close();
      }}
    >
      <form className="modal__form" onSubmit={(e) => void submit(e)}>
        <h3 id="playlist-name-title" className="modal__title">
          {creating ? t("playlistName.createTitle") : t("playlistName.renameTitle")}
        </h3>
        <label className="field">
          <span className="muted">{t("playlistName.label")}</span>
          <PixelInput
            value={name}
            maxLength={MAX_CHARS}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        {error && (
          <p className="modal__error" role="alert">
            {error}
          </p>
        )}
        <div className="modal__actions">
          <PixelButton disabled={busy} onClick={close}>
            {t("playlistName.cancel")}
          </PixelButton>
          <PixelButton type="submit" active disabled={!valid || busy}>
            {busy
              ? t("playlistName.saving")
              : creating
                ? t("playlistName.create")
                : t("playlistName.save")}
          </PixelButton>
        </div>
      </form>
    </Modal>
  );
}