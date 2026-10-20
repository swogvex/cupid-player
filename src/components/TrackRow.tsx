import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type { Track } from "../ipc/types";
import { formatTime } from "../lib/format";
import { selectCurrent, usePlayerStore } from "../state/playerStore";

type TrackRowProps = {
  track: Track;
  /** Called on double click or Enter. Only fires for tracks that have a downloaded file. */
  onPlay?: (track: Track) => void;
};

export function TrackRow({ track, onPlay }: TrackRowProps) {
  const { t } = useTranslation();
  const label = t(`status.${track.status}`);
  const isCurrent = usePlayerStore((s) => selectCurrent(s)?.id === track.id);
  const playable = track.status === "done" && track.filePath !== null;

  const play = () => {
    if (playable) onPlay?.(track);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLLIElement>) => {
    if (e.key === "Enter" && e.target === e.currentTarget) {
      e.preventDefault();
      play();
    }
  };

  const className = ["row", playable ? "row--playable" : "", isCurrent ? "is-current" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <li
      className={className}
      tabIndex={playable ? 0 : undefined}
      aria-current={isCurrent ? "true" : undefined}
      onDoubleClick={play}
      onKeyDown={onKeyDown}
    >
      <span className="ellipsis">{track.title}</span>
      <span className="ellipsis muted">{track.artist}</span>
      <span className="row__end">
        {track.status !== "done" && (
          <span className="row__flag" role="img" aria-label={label} title={label}>
            {track.status === "needs_review" || track.status === "failed" ? "!" : "…"}
          </span>
        )}
        <span>{formatTime(track.durationMs)}</span>
      </span>
    </li>
  );
}