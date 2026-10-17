import { useSettingsStore } from "../state/settingsStore";

type SpriteProps = {
  name: string;
  w: number;
  h: number;
  className?: string;
};

export function Sprite({ name, w, h, className = "" }: SpriteProps) {
  const theme = useSettingsStore((s) => s.theme);
  return (
    <img
      className={`px-sprite ${className}`.trim()}
      src={`/assets/sprites/${theme}/${name}.png`}
      alt=""
      draggable={false}
      style={{ width: `calc(var(--s) * ${w}px)`, height: `calc(var(--s) * ${h}px)` }}
    />
  );
}