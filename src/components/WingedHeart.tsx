import { AnimSprite } from "./AnimSprite";

/** Heart that beats between two flapping wings. All loops are multiples of 0.5 s, so they stay in sync. */
export function WingedHeart() {
  return (
    <div className="winged bob" aria-hidden="true">
      <AnimSprite name="wing" w={14} h={16} frames={4} fps={8} />
      <AnimSprite name="heart-beat" w={16} h={14} frames={8} fps={8} className="winged__heart" />
      <AnimSprite name="wing" w={14} h={16} frames={4} fps={8} mirror />
    </div>
  );
}