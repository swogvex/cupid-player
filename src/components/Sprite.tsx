type SpriteProps = {
  name: string;
  w: number;
  h: number;
  className?: string;
};

export function Sprite({ name, w, h, className = "" }: SpriteProps) {
  return (
    <img
      className={`px-sprite ${className}`.trim()}
      src={`/assets/sprites/${name}.png`}
      alt=""
      draggable={false}
      style={{ width: `calc(var(--s) * ${w}px)`, height: `calc(var(--s) * ${h}px)` }}
    />
  );
}