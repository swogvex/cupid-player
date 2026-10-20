import { useState } from "react";
import { hasSprite } from "../lib/sprites";
import { useSettingsStore } from "../state/settingsStore";
import { AnimSprite } from "./AnimSprite";
import { Sprite } from "./Sprite";

/** Cover slot (30x30 logical px): the theme's placeholder art until a real cover exists. */
export function CoverArt({ src = null }: { src?: string | null }) {
  const theme = useSettingsStore((s) => s.theme);
  const [failed, setFailed] = useState<string | null>(null);

  if (src && src !== failed) {
    return <img className="cover__img" src={src} alt="" draggable={false} onError={() => setFailed(src)} />;
  }
  return (
    <span className="cover-art">
      <Sprite name="cover-ph-30" />
      {hasSprite(theme, "cover-shine") && <AnimSprite name="cover-shine" className="cover-art__fx" />}
    </span>
  );
}