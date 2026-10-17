import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatTime } from "../lib/format";
import { mockNowPlaying } from "../lib/mock";
import { CoverArt } from "./CoverArt";
import { PixelButton } from "./PixelButton";
import { PixelPanel } from "./PixelPanel";
import { ProgressStar } from "./ProgressStar";
import { Sprite } from "./Sprite";
import { VolumeControl } from "./VolumeControl";

export function PlayerBar() {
  const { t } = useTranslation();
  const track = mockNowPlaying;
  const [playing, setPlaying] = useState(false);
  const [ratio, setRatio] = useState(0.35);

  return (
    <PixelPanel className="player" deco>
      <div className="player__top">
        <div className="player__cover">
          {/* H6: pass the real cover as src; it covers the theme art. */}
          <CoverArt src={null} />
        </div>
        <div className="player__info">
          <span className="muted ellipsis">{t("player.nowPlaying")}</span>
          <span className="ellipsis">{track.title}</span>
          <span className="muted ellipsis">{track.artist}</span>
        </div>
        <div className="player__controls">
          <PixelButton variant="ctl" aria-label={t("player.previous")}>
            <Sprite name="icon-prev" w={9} h={9} />
          </PixelButton>
          <PixelButton
            variant="ctl"
            large
            aria-label={playing ? t("player.pause") : t("player.play")}
            onClick={() => setPlaying((p) => !p)}
          >
            <Sprite name={playing ? "icon-pause" : "icon-play"} w={9} h={9} />
          </PixelButton>
          <PixelButton variant="ctl" aria-label={t("player.next")}>
            <Sprite name="icon-next" w={9} h={9} />
          </PixelButton>
        </div>
        <VolumeControl />
      </div>
      <div className="player__bottom">
        <span className="player__time">{formatTime(track.durationMs * ratio)}</span>
        <ProgressStar value={ratio} onChange={setRatio} label={t("player.seek")} />
        <span className="player__time player__time--end">{formatTime(track.durationMs)}</span>
      </div>
    </PixelPanel>
  );
}