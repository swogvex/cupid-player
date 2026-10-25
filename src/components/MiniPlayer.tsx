import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { convertFileSrc } from "@tauri-apps/api/core";
import { closeWindow } from "../ipc/commands";
import { initImportEvents } from "../state/importStore";
import { useMiniStore } from "../state/miniStore";
import { selectCurrent, usePlayerStore } from "../state/playerStore";
import { CoverArt } from "./CoverArt";
import { Marquee } from "./Marquee";
import { PixelButton } from "./PixelButton";
import { PixelPanel } from "./PixelPanel";
import { ProgressStar } from "./ProgressStar";
import { Sprite } from "./Sprite";
import "../styles/mini.css";

/** Own component: the position changes ~4 times per second. */
function MiniProgress() {
  const { t } = useTranslation();
  const hasTrack = usePlayerStore((s) => s.index >= 0);
  const position = usePlayerStore((s) => s.position);
  const duration = usePlayerStore((s) => s.duration);
  const playing = usePlayerStore((s) => s.playing);
  const seekRatio = usePlayerStore((s) => s.seekRatio);
  const [scrub, setScrub] = useState<number | null>(null);

  const ratio = duration > 0 ? Math.min(1, position / duration) : 0;
  return (
    <ProgressStar
      value={scrub ?? ratio}
      onChange={setScrub}
      onCommit={(v) => {
        seekRatio(v);
        setScrub(null);
      }}
      label={t("player.seek")}
      beating={playing}
      disabled={!hasTrack}
    />
  );
}

/**
 * Vertical mini player (104x156 logical px at x2). Every non-interactive element carries
 * data-tauri-drag-region (Tauri only drags from the element that has it), so the whole
 * window moves except the buttons and the progress bar.
 */
export function MiniPlayer() {
  const { t } = useTranslation();
  const track = usePlayerStore(selectCurrent);
  const playing = usePlayerStore((s) => s.playing);
  const error = usePlayerStore((s) => s.error);
  const { togglePlay, next, prev } = usePlayerStore.getState();
  const setMini = useMiniStore((s) => s.setMini);

  // ImportBox (sidebar) is unmounted while the mini player is shown: keep listening here.
  useEffect(() => initImportEvents(), []);

  const coverSrc = useMemo(
    () => (track?.coverPath ? convertFileSrc(track.coverPath) : null),
    [track?.coverPath],
  );
  const title = track ? track.title : t("player.nothingPlaying");
  const artist = error ? t("player.cantPlay") : (track?.artist ?? "");
  const caption = artist ? `${title} - ${artist}` : title;

  return (
    <div className="mini-root" data-tauri-drag-region>
      <PixelPanel className="mini" data-tauri-drag-region>
        <div className="mini__top" data-tauri-drag-region>
          <PixelButton variant="mini" aria-label={t("window.expand")} onClick={() => void setMini(false)}>
            <Sprite name="win-icon-max" w={7} h={7} />
          </PixelButton>
          <PixelButton variant="mini" aria-label={t("window.close")} onClick={() => void closeWindow()}>
            <Sprite name="win-icon-close" w={7} h={7} />
          </PixelButton>
        </div>

        <div className="mini__cover" data-tauri-drag-region title={caption}>
          <CoverArt src={coverSrc} />
        </div>

        <div className="mini__text" data-tauri-drag-region data-marquee-host title={caption}>
          <Marquee text={title} always={playing} />
          <Marquee className="muted" text={artist} always={playing} />
        </div>

        <div className="mini__controls" data-tauri-drag-region>
          <PixelButton variant="ctl" aria-label={t("player.previous")} onClick={prev} disabled={!track}>
            <Sprite name="icon-prev" w={9} h={9} />
          </PixelButton>
          <PixelButton
            variant="ctl"
            large
            aria-label={playing ? t("player.pause") : t("player.play")}
            onClick={togglePlay}
            disabled={!track}
          >
            <Sprite name={playing ? "icon-pause" : "icon-play"} w={9} h={9} />
          </PixelButton>
          <PixelButton variant="ctl" aria-label={t("player.next")} onClick={next} disabled={!track}>
            <Sprite name="icon-next" w={9} h={9} />
          </PixelButton>
        </div>

        <div className="mini__bar" data-tauri-drag-region>
          <MiniProgress />
        </div>
      </PixelPanel>
    </div>
  );
}