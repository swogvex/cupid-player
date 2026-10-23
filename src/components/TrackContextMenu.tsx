import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { revealTrack } from "../ipc/commands";
import { useErrorText } from "../lib/useErrorText";
import { useLibraryStore } from "../state/libraryStore";
import { usePlayerStore } from "../state/playerStore";
import { useTrackMenuStore } from "../state/trackMenuStore";
import { Overlay } from "./Overlay";

export function TrackContextMenu() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const menu = useTrackMenuStore((s) => s.menu);
  const track = useLibraryStore((s) =>
    menu ? s.tracks.find((x) => x.id === menu.trackId) : undefined,
  );
  const ref = useRef<HTMLDivElement>(null);
  const visible = menu !== null && track !== undefined;

  // Keep the menu inside the window and focus its first item. Positioned through
  // the DOM (not state) so it never flashes at the wrong place.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!visible || !menu || !el) return;
    const r = el.getBoundingClientRect();
    el.style.left = `${Math.max(0, Math.min(menu.x, window.innerWidth - r.width))}px`;
    el.style.top = `${Math.max(0, Math.min(menu.y, window.innerHeight - r.height))}px`;
    el.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
  }, [visible, menu]);

  useEffect(() => {
    if (!menu) return;
    const close = () => useTrackMenuStore.getState().closeMenu();
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    window.addEventListener("wheel", close, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("wheel", close);
    };
  }, [menu]);

  if (!menu || !track) return null;

  const playable = track.status === "done" && track.filePath !== null;
  const hasFile = track.filePath !== null;
  const store = useTrackMenuStore.getState();
  const run = (fn: () => void) => () => {
    store.closeMenu();
    fn();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(i + 1) % items.length].focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length].focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0].focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1].focus();
    } else if (e.key === "Tab") {
      e.preventDefault();
    }
  };

  return (
    <Overlay>
      <div
        ref={ref}
        className="ctx"
        role="menu"
        aria-label={t("menu.label")}
        style={{ left: menu.x, top: menu.y }}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
      >
        <button
          type="button"
          role="menuitem"
          className="ctx__item"
          disabled={!playable}
          onClick={run(() => usePlayerStore.getState().playTracks([track], track.id))}
        >
          {t("menu.play")}
        </button>
        <button
          type="button"
          role="menuitem"
          className="ctx__item"
          disabled={!playable}
          onClick={run(() => usePlayerStore.getState().playNext(track))}
        >
          {t("menu.playNext")}
        </button>
        <button
          type="button"
          role="menuitem"
          className="ctx__item"
          disabled={!playable}
          onClick={run(() => usePlayerStore.getState().enqueue(track))}
        >
          {t("menu.enqueue")}
        </button>
        <div className="ctx__sep" role="separator" />
        <button
          type="button"
          role="menuitem"
          className="ctx__item"
          onClick={run(() => store.openEdit(track.id))}
        >
          {t("menu.edit")}
        </button>
        <button
          type="button"
          role="menuitem"
          className="ctx__item"
          disabled={!hasFile}
          onClick={run(() => {
            void revealTrack(track.id).catch((e) => store.notify(errorText(e)));
          })}
        >
          {t("menu.reveal")}
        </button>
        <div className="ctx__sep" role="separator" />
        <button
          type="button"
          role="menuitem"
          className="ctx__item"
          onClick={run(() => store.openDelete(track.id))}
        >
          {t("menu.delete")}
        </button>
      </div>
    </Overlay>
  );
}