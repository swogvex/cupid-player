import { useVirtualizer } from "@tanstack/react-virtual";
import { useDeferredValue, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { addToPlaylist } from "../ipc/commands";
import { filterTracks } from "../lib/search";
import { estimateRowHeight } from "../lib/rowHeight";
import { useErrorText } from "../lib/useErrorText";
import { useLibraryStore } from "../state/libraryStore";
import { usePlaylistMenuStore } from "../state/playlistMenuStore";
import { Marquee } from "./Marquee";
import { Modal } from "./Modal";
import { Overlay } from "./Overlay";
import { PixelButton } from "./PixelButton";
import { PixelInput } from "./PixelInput";

export function TrackPickerDialog() {
  const id = usePlaylistMenuStore((s) => s.pickerFor);
  const playlist = useLibraryStore((s) =>
    id === null ? undefined : s.playlists.find((p) => p.id === id),
  );
  if (!playlist) return null;
  return (
    <Overlay>
      <PickerForm key={playlist.id} playlistId={playlist.id} name={playlist.name} />
    </Overlay>
  );
}

function PickerForm({ playlistId, name }: { playlistId: number; name: string }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const close = usePlaylistMenuStore((s) => s.closePicker);
  const tracks = useLibraryStore((s) => s.tracks);
  const memberIds = useLibraryStore((s) => s.members[playlistId]);
  const inList = useMemo(() => new Set(memberIds ?? []), [memberIds]);

  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => filterTracks(tracks, deferred), [tracks, deferred]);
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: estimateRowHeight,
    getItemKey: (i) => visible[i].id,
    overscan: 8,
  });

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const tr of visible) if (!inList.has(tr.id)) next.add(tr.id);
      return next;
    });

  const submit = async () => {
    if (selected.size === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await addToPlaylist(playlistId, [...selected]);
      await useLibraryStore.getState().refreshPlaylists();
      close();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      titleId="picker-title"
      onClose={() => {
        if (!busy) close();
      }}
    >
      <h3 id="picker-title" className="modal__title">
        {t("picker.title")}
      </h3>
      <Marquee className="muted" text={name} always />
      <PixelInput
        placeholder={t("picker.search")}
        aria-label={t("picker.search")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
        spellCheck={false}
      />

      <div ref={scrollRef} className="picker__list" role="group" aria-label={t("picker.title")}>
        {visible.length === 0 ? (
          <p className="muted picker__empty">{t("picker.empty")}</p>
        ) : (
          <ul className="picker__rows" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const tr = visible[item.index];
              const already = inList.has(tr.id);
              return (
                <li
                  key={item.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  className="picker__item"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <label
                    className={already ? "pick pick--disabled" : "pick"}
                    title={already ? t("picker.alreadyIn") : undefined}
                  >
                    <input
                      type="checkbox"
                      className="pick__input"
                      checked={already || selected.has(tr.id)}
                      disabled={already}
                      onChange={() => toggle(tr.id)}
                    />
                    <span className="pick__box" aria-hidden="true" />
                    <span className="ellipsis">{tr.title}</span>
                    <span className="ellipsis muted">{tr.artist}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {error && (
        <p className="modal__error" role="alert">
          {error}
        </p>
      )}

      <div className="picker__bar">
        <span className="muted">{t("picker.selected", { count: selected.size })}</span>
        <div className="modal__actions">
          <PixelButton disabled={busy || visible.length === 0} onClick={selectVisible}>
            {t("picker.selectVisible")}
          </PixelButton>
          <PixelButton disabled={busy} onClick={close}>
            {t("picker.cancel")}
          </PixelButton>
          <PixelButton active disabled={busy || selected.size === 0} onClick={() => void submit()}>
            {t("picker.add", { count: selected.size })}
          </PixelButton>
        </div>
      </div>
    </Modal>
  );
}