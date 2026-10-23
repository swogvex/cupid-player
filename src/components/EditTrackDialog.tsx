import { convertFileSrc } from "@tauri-apps/api/core";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { commitCover, discardCover, pickCover, updateTags } from "../ipc/commands";
import type { Track } from "../ipc/types";
import { useErrorText } from "../lib/useErrorText";
import { useLibraryStore } from "../state/libraryStore";
import { usePlayerStore } from "../state/playerStore";
import { useTrackMenuStore } from "../state/trackMenuStore";
import { CoverArt } from "./CoverArt";
import { Modal } from "./Modal";
import { Overlay } from "./Overlay";
import { PixelButton } from "./PixelButton";
import { PixelInput } from "./PixelInput";

const MAX_CHARS = 200;

export function EditTrackDialog() {
  const id = useTrackMenuStore((s) => s.editingId);
  const track = useLibraryStore((s) => (id === null ? undefined : s.tracks.find((x) => x.id === id)));
  if (!track) return null;
  return (
    <Overlay>
      <EditForm key={track.id} track={track} />
    </Overlay>
  );
}

function EditForm({ track }: { track: Track }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const close = useTrackMenuStore((s) => s.closeEdit);
  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(track.artist);
  const [album, setAlbum] = useState(track.album ?? "");
  // A cover picked in this dialog: it only becomes the real cover when saving.
  const [staged, setStaged] = useState<{ path: string; nonce: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasFile = track.filePath !== null;
  const valid = title.trim() !== "" && artist.trim() !== "";
  const tagsDirty =
    title !== track.title || artist !== track.artist || album !== (track.album ?? "");

  const coverSrc = staged
    ? `${convertFileSrc(staged.path)}?t=${staged.nonce}`
    : track.coverPath
      ? convertFileSrc(track.coverPath)
      : null;

  const apply = (updated: Track) => {
    useLibraryStore.getState().replaceTrack(updated);
    usePlayerStore.getState().updateTrack(updated);
  };

  // Cancel, Escape and a click outside all end up here: the staged cover is dropped.
  const cancel = () => {
    if (busy) return;
    if (staged) void discardCover(track.id).catch(() => undefined);
    close();
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    if (!tagsDirty && !staged) return close();
    setBusy(true);
    setError(null);
    try {
      if (tagsDirty) {
        apply(
          await updateTags(track.id, {
            title,
            artist,
            album: album.trim() === "" ? null : album,
          }),
        );
      }
      if (staged) apply(await commitCover(track.id));
      close();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  const changeCover = async () => {
    setBusy(true);
    setError(null);
    try {
      const path = await pickCover(track.id);
      if (path) setStaged({ path, nonce: Date.now() });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal titleId="edit-title" onClose={cancel}>
      <form className="modal__form" onSubmit={(e) => void save(e)}>
        <h3 id="edit-title" className="modal__title">
          {t("edit.title")}
        </h3>

        <div className="edit__top">
          <span className="player__cover">
            <CoverArt src={coverSrc} />
          </span>
          <PixelButton disabled={!hasFile || busy} onClick={() => void changeCover()}>
            {t("edit.changeCover")}
          </PixelButton>
          {!hasFile && <span className="muted">{t("edit.noFileForCover")}</span>}
          {hasFile && staged && <span className="muted">{t("edit.coverPending")}</span>}
        </div>

        <label className="field">
          <span className="muted">{t("edit.fieldTitle")}</span>
          <PixelInput
            value={title}
            maxLength={MAX_CHARS}
            onChange={(e) => setTitle(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="field">
          <span className="muted">{t("edit.fieldArtist")}</span>
          <PixelInput
            value={artist}
            maxLength={MAX_CHARS}
            onChange={(e) => setArtist(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="field">
          <span className="muted">{t("edit.fieldAlbum")}</span>
          <PixelInput
            value={album}
            maxLength={MAX_CHARS}
            onChange={(e) => setAlbum(e.target.value)}
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
          <PixelButton disabled={busy} onClick={cancel}>
            {t("edit.cancel")}
          </PixelButton>
          <PixelButton type="submit" active disabled={!valid || busy}>
            {busy ? t("edit.saving") : t("edit.save")}
          </PixelButton>
        </div>
      </form>
    </Modal>
  );
}