import { useLayoutEffect, useRef } from "react";

/** Scroll speed in real px per second. */
const SPEED = 32;
/** Each leg of the ping-pong takes this share of one cycle (see @keyframes marquee-bounce). */
const LEG = 0.36;

type MarqueeProps = {
  text: string;
  className?: string;
  /** Animate all the time. Otherwise it moves only while the row/host is hovered or focused. */
  always?: boolean;
  /** Tooltip; defaults to the text itself. */
  title?: string;
};

/**
 * One line of text that never widens its container: "…" at rest and, when it does
 * not fit, a smooth ping-pong scroll that reveals the whole text.
 * To trigger it from a whole row, put `data-marquee-host` on the row.
 */
export function Marquee({ text, className = "", always = false, title }: MarqueeProps) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const inner = innerRef.current;
    if (!box || !inner) return;
    const measure = () => {
      const shift = Math.ceil(inner.scrollWidth - box.clientWidth);
      if (shift > 1) {
        box.dataset.overflow = "true";
        box.style.setProperty("--shift", `${-shift}px`);
        box.style.setProperty("--dur", `${Math.max(5, shift / (SPEED * LEG))}s`);
      } else {
        delete box.dataset.overflow;
        box.style.removeProperty("--shift");
        box.style.removeProperty("--dur");
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [text]);

  const cls = ["marquee", always ? "marquee--always" : "", className].filter(Boolean).join(" ");
  return (
    <span ref={boxRef} className={cls} title={title ?? text}>
      <span ref={innerRef} className="marquee__inner">
        {text}
      </span>
    </span>
  );
}