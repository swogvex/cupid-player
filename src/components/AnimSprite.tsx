import type { CSSProperties } from "react";
import { useSettingsStore } from "../state/settingsStore";

type AnimSpriteProps = {
  /** Strip name in /assets/sprites/<theme> (without .png). */
  name: string;
  /** Size of ONE frame, in logical px. */
  w: number;
  h: number;
  /** Number of cells in the strip (the length of its "# order:"). */
  frames: number;
  fps?: number;
  /** Seconds before the loop starts: use it to desynchronise copies. */
  delay?: number;
  mirror?: boolean;
  className?: string;
};

export function AnimSprite({
  name,
  w,
  h,
  frames,
  fps = 8,
  delay = 0,
  mirror = false,
  className = "",
}: AnimSpriteProps) {
  const theme = useSettingsStore((s) => s.theme);
  const style = {
    width: `calc(var(--s) * ${w}px)`,
    height: `calc(var(--s) * ${h}px)`,
    backgroundImage: `url(/assets/sprites/${theme}/${name}.png)`,
    transform: mirror ? "scaleX(-1)" : undefined,
    animationDuration: `${frames / fps}s`,
    animationDelay: delay ? `${delay}s` : undefined,
    "--sheet-w": w * frames,
    "--frames": frames,
  } as CSSProperties;

  return <span className={`px-anim ${className}`.trim()} style={style} aria-hidden="true" />;
}