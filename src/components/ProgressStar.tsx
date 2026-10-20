import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { hasSprite, spriteInfo } from "../lib/sprites";
import { useSettingsStore } from "../state/settingsStore";
import { Sprite } from "./Sprite";

/** w and h are only a fallback: the real size is read from the theme's PNG. */
export type Knob = { name: string; dragName?: string; beatName?: string; w: number; h: number };

export const KNOB_MUSIC: Knob = {
  name: "knob-music",
  dragName: "knob-music-drag",
  beatName: "knob-music-beat",
  w: 11,
  h: 11,
};
export const KNOB_VOLUME: Knob = { name: "knob-volume", w: 9, h: 8 };

type ProgressStarProps = {
  /** 0..1 */
  value: number;
  onChange?: (value: number) => void;
  /** Called when the drag ends or a key is pressed (use it to seek). */
  onCommit?: (value: number) => void;
  step?: number;
  label: string;
  disabled?: boolean;
  knob?: Knob;
  /** The knob plays its beat animation (if the theme has one) while true. */
  beating?: boolean;
};

/** Height of the bar container in logical px (see .px-progress). */
const BAR_H = 11;

const clamp = (v: number) => Math.min(1, Math.max(0, v));

export function ProgressStar({
  value,
  onChange,
  onCommit,
  step = 0.02,
  label,
  disabled = false,
  knob = KNOB_MUSIC,
  beating = false,
}: ProgressStarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const theme = useSettingsStore((s) => s.theme);
  const p = clamp(value);

  const info = spriteInfo(theme, knob.name);
  const knobW = info?.w ?? knob.w;
  const knobH = info?.h ?? knob.h;

  // Free space at each end = half the knob, so the knob stops before the edge.
  const pad = Math.ceil(knobW / 2);
  const knobTop = Math.floor((BAR_H - knobH) / 2);
  const knobHalf = Math.floor(knobW / 2);

  const shown =
    dragging && knob.dragName
      ? knob.dragName
      : beating && knob.beatName && hasSprite(theme, knob.beatName)
        ? knob.beatName
        : knob.name;

  const ratioFrom = (e: PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return value;
    const r = el.getBoundingClientRect();
    const padPx = (pad * r.height) / BAR_H; // = pad * --s
    return clamp((e.clientX - r.left - padPx) / (r.width - 2 * padPx));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    onChange?.(ratioFrom(e));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging) onChange?.(ratioFrom(e));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    onCommit?.(ratioFrom(e));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = clamp(value + step);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = clamp(value - step);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = 1;
    if (next === null) return;
    e.preventDefault();
    onChange?.(next);
    onCommit?.(next);
  };

  return (
    <div
      ref={ref}
      className="px-progress"
      style={{ "--p": p, "--pad": pad } as CSSProperties}
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(p * 100)}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        if (!dragging) return;
        setDragging(false);
        onCommit?.(value);
      }}
      onKeyDown={onKeyDown}
    >
      <div className="px-progress__track" />
      {p > 0 && <div className="px-progress__fill" />}
      <div
        className="px-progress__star"
        style={{ top: `calc(var(--s) * ${knobTop}px)`, marginLeft: `calc(var(--s) * ${-knobHalf}px)` }}
      >
        <Sprite name={shown} w={knobW} h={knobH} />
      </div>
    </div>
  );
}