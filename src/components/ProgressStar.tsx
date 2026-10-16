import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Sprite } from "./Sprite";

type ProgressStarProps = {
  /** 0..1 */
  value: number;
  onChange?: (value: number) => void;
  /** Called when the drag ends or a key is pressed (use it to seek). */
  onCommit?: (value: number) => void;
  step?: number;
  label: string;
  disabled?: boolean;
};

const clamp = (v: number) => Math.min(1, Math.max(0, v));

export function ProgressStar({
  value,
  onChange,
  onCommit,
  step = 0.02,
  label,
  disabled = false,
}: ProgressStarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const pct = clamp(value) * 100;

  const ratioFrom = (e: PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return value;
    const r = el.getBoundingClientRect();
    return clamp((e.clientX - r.left) / r.width);
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
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDragging(false)}
      onKeyDown={onKeyDown}
    >
      <div className="px-progress__track" />
      <div className="px-progress__fill" style={{ width: `${pct}%` }} />
      <div className="px-progress__star" style={{ left: `${pct}%` }}>
        <Sprite name={dragging ? "star-9-drag" : "star-9"} w={9} h={9} />
      </div>
    </div>
  );
}