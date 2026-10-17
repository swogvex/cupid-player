import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../state/settingsStore";
import { PixelButton } from "./PixelButton";
import { KNOB_VOLUME, ProgressStar } from "./ProgressStar";
import { Sprite } from "./Sprite";

export function VolumeControl() {
  const { t } = useTranslation();
  const volume = useSettingsStore((s) => s.volume);
  const muted = useSettingsStore((s) => s.muted);
  const setVolume = useSettingsStore((s) => s.setVolume);
  const toggleMuted = useSettingsStore((s) => s.toggleMuted);

  const level = muted ? 0 : volume;
  const icon = level === 0 ? "icon-vol-mute" : level < 0.5 ? "icon-vol-low" : "icon-vol-high";

  return (
    <div className="volume">
      <PixelButton
        variant="mini"
        aria-label={level === 0 ? t("player.unmute") : t("player.mute")}
        aria-pressed={level === 0}
        onClick={toggleMuted}
      >
        <Sprite name={icon} w={7} h={7} />
      </PixelButton>
      <div className="volume__bar">
        <ProgressStar value={level} onChange={setVolume} label={t("player.volume")} knob={KNOB_VOLUME} step={0.05} />
      </div>
    </div>
  );
}