import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { convertFileSrc } from "@tauri-apps/api/core";
import { formatTime } from "../lib/format";
import { selectCurrent, usePlayerStore } from "../state/playerStore";
import { CoverArt } from "./CoverArt";
import { PixelButton } from "./PixelButton";
import { PixelPanel } from "./PixelPanel";
import { ProgressStar } from "./ProgressStar";
import { Sprite } from "./Sprite";
import { VolumeControl } from "./VolumeControl";
import { Marquee } from "./Marquee";

/** Separate component: position changes ~4 times per second and must not re-render the whole bar. */
function PlayerProgress({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  const hasTrack = usePlayerStore((s) => s.index >= 0);
  const position = usePlayerStore((s) => s.position);
  const duration = usePlayerStore((s) => s.duration);
  const playing = usePlayerStore((s) => s.playing);
  const seekRatio = usePlayerStore((s) => s.seekRatio);
  const [scrub, setScrub] = useState<number | null>(null);

  const ratio = duration > 0 ? Math.min(1, position / duration) : 0;
  const shown = scrub ?? ratio;

  return (
    <div className="player__bottom">
      <span className="player__time">{formatTime(shown * duration * 1000)}</span>
      <ProgressStar
        value={shown}
        onChange={setScrub}
        onCommit={(v) => {
          seekRatio(v);
          setScrub(null);
        }}
        label={t("player.seek")}
        beating={playing}
        disabled={!hasTrack}
      />
      <span className="player__time player__time--end">{formatTime(duration * 1000)}</span>
      {children}
    </div>
  );
}

export function PlayerBar() {
  const { t } = useTranslation();
  const track = usePlayerStore(selectCurrent);
  const playing = usePlayerStore((s) => s.playing);
  const error = usePlayerStore((s) => s.error);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const queueOpen = usePlayerStore((s) => s.queueOpen);
  const { togglePlay, next, prev, toggleShuffle, cycleRepeat, toggleQueue } = usePlayerStore.getState();

  const coverSrc = useMemo(() => (track?.coverPath ? convertFileSrc(track.coverPath) : null), [track?.coverPath]);
  const repeatLabel = repeat === "one" ? t("player.repeatOne") : repeat === "all" ? t("player.repeatAll") : t("player.repeat");

  return (
    <PixelPanel className="player" deco>
      <div className="player__top">
        <div className="player__cover">
          <CoverArt src={coverSrc} />
        </div>
        <div className="player__info" data-marquee-host>
          <Marquee className="muted" text={t("player.nowPlaying")} />
          <Marquee text={track ? track.title : t("player.nothingPlaying")} always={playing} />
          <Marquee className="muted" text={error ? t("player.cantPlay") : (track?.artist ?? "")} always={playing} />
        </div>
        <div className="player__controls">
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
        <div className="player__extras">
          <PixelButton variant="mini" active={shuffle} aria-label={t("player.shuffle")} aria-pressed={shuffle} onClick={toggleShuffle}>
            <Sprite name="icon-shuffle" w={7} h={7} />
          </PixelButton>
          <PixelButton variant="mini" active={repeat !== "off"} aria-label={repeatLabel} aria-pressed={repeat !== "off"} onClick={cycleRepeat}>
            <Sprite name={repeat === "one" ? "icon-repeat-one" : "icon-repeat"} w={7} h={7} />
          </PixelButton>
          <PixelButton variant="mini" active={queueOpen} aria-label={t("player.queue")} aria-pressed={queueOpen} onClick={toggleQueue}>
            <Sprite name="icon-queue" w={7} h={7} />
          </PixelButton>
        </div>
      </div>
      <PlayerProgress>
        <VolumeControl />
      </PlayerProgress>
    </PixelPanel>
  );
}