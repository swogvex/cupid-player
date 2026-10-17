import { useTranslation } from "react-i18next";
import { formatTime } from "../lib/format";
import type { MockTrack } from "../lib/mock";

export function TrackRow({ track }: { track: MockTrack }) {
  const { t } = useTranslation();
  const label = t(`status.${track.status}`);

  return (
    <li className="row">
      <span className="ellipsis">{track.title}</span>
      <span className="ellipsis muted">{track.artist}</span>
      <span className="row__end">
        {track.status !== "done" && (
          <span className="row__flag" role="img" aria-label={label} title={label}>
            {track.status === "needs_review" ? "!" : "…"}
          </span>
        )}
        <span>{formatTime(track.durationMs)}</span>
      </span>
    </li>
  );
}