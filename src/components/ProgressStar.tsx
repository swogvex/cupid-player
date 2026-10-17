import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { Sprite } from "./Sprite";

export type Knob = { name: string; dragName?: string; w: number; h: number };

export const KNOB_MUSIC: Knob = { name: "knob-music", dragName: "knob-music-drag", w: 11, h: 11 };
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
}: ProgressStarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const p = clamp(value);

  // Free space at each end = half the knob, so the knob stops before the edge.
  const pad = Math.ceil(knob.w / 2);
  const knobTop = Math.floor((BAR_H - knob.h) / 2);
  const knobHalf = Math.floor(knob.w / 2);

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
      onPointerCancel={() => setDragging(false)}
      onKeyDown={onKeyDown}
    >
      <div className="px-progress__track" />
      {p > 0 && <div className="px-progress__fill" />}
      <div
        className="px-progress__star"
        style={{ top: `calc(var(--s) * ${knobTop}px)`, marginLeft: `calc(var(--s) * ${-knobHalf}px)` }}
      >
        <Sprite name={dragging && knob.dragName ? knob.dragName : knob.name} w={knob.w} h={knob.h} />
      </div>
    </div>
  );
}