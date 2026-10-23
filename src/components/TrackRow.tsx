import type { CSSProperties, KeyboardEvent, MouseEvent, Ref } from "react";
import { useTranslation } from "react-i18next";
import type { Track } from "../ipc/types";
import { formatTime } from "../lib/format";
import { useImportStore } from "../state/importStore";
import { selectCurrent, usePlayerStore } from "../state/playerStore";
import { useTrackMenuStore } from "../state/trackMenuStore";

type TrackRowProps = {
  track: Track;
  /** Called on double click or Enter. Only fires for tracks that have a downloaded file. */
  onPlay?: (track: Track) => void;
  /** Only used by virtualized lists. */
  style?: CSSProperties;
  rowRef?: Ref<HTMLLIElement>;
  /** Position in the list (0-based) and list size, for the virtualizer and screen readers. */
  index?: number;
  total?: number;
};

export function TrackRow({ track, onPlay, style, rowRef, index, total }: TrackRowProps) {
  const { t } = useTranslation();
  const label = t(`status.${track.status}`);
  const isCurrent = usePlayerStore((s) => selectCurrent(s)?.id === track.id);
  const importing = useImportStore((s) => s.phase === "starting" || s.phase === "running");
  const playable = track.status === "done" && track.filePath !== null;
  const needsAttention = track.status === "needs_review" || track.status === "failed";
  const retryLabel = `${label} · ${t("row.retry")}`;

  const play = () => {
    if (playable) onPlay?.(track);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLLIElement>) => {
    if (e.key === "Enter" && e.target === e.currentTarget) {
      e.preventDefault();
      play();
    }
  };
  // Right click, or the keyboard's menu key / Shift+F10 on a focused row.
  const onContextMenu = (e: MouseEvent<HTMLLIElement>) => {
    e.preventDefault();
    useTrackMenuStore.getState().openMenu(track.id, e.clientX, e.clientY);
  };

  const className = [
    "row",
    index !== undefined ? "row--virtual" : "",
    playable ? "row--playable" : "",
    isCurrent ? "is-current" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li
      ref={rowRef}
      style={style}
      data-index={index}
      aria-posinset={index !== undefined ? index + 1 : undefined}
      aria-setsize={total}
      className={className}
      tabIndex={playable ? 0 : undefined}
      aria-current={isCurrent ? "true" : undefined}
      onDoubleClick={play}
      onKeyDown={onKeyDown}
      onContextMenu={onContextMenu}
    >
      <span className="ellipsis">{track.title}</span>
      <span className="ellipsis muted">{track.artist}</span>
      <span className="row__end">
        {needsAttention && (
          <button
            type="button"
            className="row__flag row__retry"
            title={retryLabel}
            aria-label={retryLabel}
            disabled={importing}
            onClick={() => void useImportStore.getState().retry(track.id)}
          >
            !
          </button>
        )}
        {track.status !== "done" && !needsAttention && (
          <span className="row__flag" role="img" aria-label={label} title={label}>
            …
          </span>
        )}
        <span>{formatTime(track.durationMs)}</span>
      </span>
    </li>
  );
}