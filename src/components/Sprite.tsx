import { spriteInfo } from "../lib/sprites";
import { useSettingsStore } from "../state/settingsStore";
import { AnimSprite } from "./AnimSprite";

type SpriteProps = {
  name: string;
  /** Optional: the size is read from the theme's PNG. Only a fallback. */
  w?: number;
  h?: number;
  className?: string;
};

export function Sprite({ name, w, h, className = "" }: SpriteProps) {
  const theme = useSettingsStore((s) => s.theme);
  const info = spriteInfo(theme, name);
  const width = info?.w ?? w;
  const height = info?.h ?? h;
  if (width === undefined || height === undefined) return null;
  // A multi-frame strip is played instead of shown whole.
  if (info && info.f > 1) return <AnimSprite name={name} className={className} />;
  return (
    <img
      className={`px-sprite ${className}`.trim()}
      src={`/assets/sprites/${theme}/${name}.png`}
      alt=""
      draggable={false}
      style={{ width: `calc(var(--s) * ${width}px)`, height: `calc(var(--s) * ${height}px)` }}
    />
  );
}