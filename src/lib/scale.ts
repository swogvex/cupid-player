export const BASE_W = 352;
export const BASE_H = 208;

type ScaleMode = "full" | "mini";

const BASES = {
  full: { w: BASE_W, h: BASE_H, min: 2 },
  mini: { w: 104, h: 156, min: 1 },
} as const;

/** Absorbs sub-pixel rounding of the window size (415.6 px must still count as 416). */
const TOLERANCE_PX = 2;

let mode: ScaleMode = "full";

/** The mini player has its own 104x156 design; call applyCssScale() after changing it. */
export function setScaleMode(next: ScaleMode): void {
  mode = next;
}

/** Largest integer scale at which the design still fits. Never below the mode's minimum. */
export function fitScale(width: number, height: number, m: ScaleMode = mode): number {
  const base = BASES[m];
  const raw = Math.min((width + TOLERANCE_PX) / base.w, (height + TOLERANCE_PX) / base.h);
  return Math.max(base.min, Math.floor(raw));
}

/**
 * Integer --s plus the logical size of the frame (--lw x --lh).
 * The layout is fluid: any extra space is given to the layout, not to a bigger scale.
 */
export function applyCssScale(): void {
  const base = BASES[mode];
  const w = window.innerWidth;
  const h = window.innerHeight;
  const s = fitScale(w, h);
  const root = document.documentElement.style;
  root.setProperty("--s", String(s));
  root.setProperty("--lw", String(Math.max(base.w, Math.floor(w / s))));
  root.setProperty("--lh", String(Math.max(base.h, Math.floor(h / s))));
}

/** Keeps the CSS scale in sync with the window (once per frame). Returns a cleanup function. */
export function startScaleTracking(): () => void {
  let raf = 0;
  const onResize = () => {
    window.cancelAnimationFrame(raf);
    raf = window.requestAnimationFrame(applyCssScale);
  };

  applyCssScale();
  window.addEventListener("resize", onResize);
  return () => {
    window.cancelAnimationFrame(raf);
    window.removeEventListener("resize", onResize);
  };
}