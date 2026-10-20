import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { usePlayerStore } from "../state/playerStore";
import { PixelButton } from "../components/PixelButton";
import { PixelPanel } from "../components/PixelPanel";
import { Sprite } from "../components/Sprite";

export function QueueView() {
  const { t } = useTranslation();
  const open = usePlayerStore((s) => s.queueOpen);
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);
  const { playAt, move, removeAt, clearQueue, setQueueOpen } = usePlayerStore.getState();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setQueueOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setQueueOpen]);

  if (!open) return null;

  return (
    <aside className="queue" aria-label={t("queue.title")}>
      <PixelPanel className="queue__panel">
        <div className="queue__head">
          <span>{t("queue.title")}</span>
          <PixelButton variant="mini" aria-label={t("queue.clear")} onClick={clearQueue} disabled={queue.length < 2}>
            <Sprite name="icon-remove" w={7} h={7} />
          </PixelButton>
        </div>
        {queue.length === 0 ? (
          <p className="muted queue__empty">{t("queue.empty")}</p>
        ) : (
          <ol className="queue__list">
            {queue.map((track, i) => (
              <li key={`${i}-${track.id}`} className={i === index ? "queue__item is-current" : "queue__item"}>
                <button type="button" className="queue__main" onClick={() => playAt(i)}>
                  <span className="ellipsis">{track.title}</span>
                  <span className="muted ellipsis">{track.artist}</span>
                </button>
                <PixelButton variant="mini" aria-label={t("queue.moveUp")} disabled={i === 0} onClick={() => move(i, i - 1)}>
                  <Sprite name="icon-up" w={7} h={7} />
                </PixelButton>
                <PixelButton
                  variant="mini"
                  aria-label={t("queue.moveDown")}
                  disabled={i === queue.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  <Sprite name="icon-down" w={7} h={7} />
                </PixelButton>
                <PixelButton variant="mini" aria-label={t("queue.remove")} onClick={() => removeAt(i)}>
                  <Sprite name="icon-remove" w={7} h={7} />
                </PixelButton>
              </li>
            ))}
          </ol>
        )}
      </PixelPanel>
    </aside>
  );
}