import type { CSSProperties } from "react";
import { spriteInfo } from "../lib/sprites";
import { useSettingsStore } from "../state/settingsStore";

type AnimSpriteProps = {
  /** Strip name in /assets/sprites/<theme> (without .png). */
  name: string;
  /** Optional fallbacks: size, cell count and fps are read from the theme's PNG ("# fps:" in the sprite). */
  w?: number;
  h?: number;
  frames?: number;
  fps?: number;
  /** Seconds before the loop starts: use it to desynchronise copies. */
  delay?: number;
  mirror?: boolean;
  className?: string;
};

export function AnimSprite({ name, w, h, frames, fps, delay = 0, mirror = false, className = "" }: AnimSpriteProps) {
  const theme = useSettingsStore((s) => s.theme);
  const info = spriteInfo(theme, name);
  const width = info?.w ?? w;
  const height = info?.h ?? h;
  const count = info?.f ?? frames;
  if (width === undefined || height === undefined || count === undefined) return null;
  const rate = fps ?? info?.r ?? 8;

  const style = {
    width: `calc(var(--s) * ${width}px)`,
    height: `calc(var(--s) * ${height}px)`,
    backgroundImage: `url(/assets/sprites/${theme}/${name}.png)`,
    transform: mirror ? "scaleX(-1)" : undefined,
    animationDuration: `${count / rate}s`,
    animationDelay: delay ? `${delay}s` : undefined,
    "--sheet-w": width * count,
    "--frames": count,
  } as CSSProperties;

  return <span className={`px-anim ${className}`.trim()} style={style} aria-hidden="true" />;
}