export const BASE_W = 352;
export const BASE_H = 208;

const MIN_SCALE = 2;
/** Absorbs sub-pixel rounding of the window size (415.6 px must still count as 416). */
const TOLERANCE_PX = 2;

/**
 * Only kept so ipc/commands.ts keeps compiling while set_window_scale exists.
 * It disappears together with that command (H13 cleanup).
 */
export type Scale = 2 | 3 | 4;

/** Largest integer scale at which the 352x208 design still fits. Never below 2. */
export function fitScale(width: number, height: number): number {
  const raw = Math.min((width + TOLERANCE_PX) / BASE_W, (height + TOLERANCE_PX) / BASE_H);
  return Math.max(MIN_SCALE, Math.floor(raw));
}

/**
 * Integer --s plus the logical size of the frame (--lw x --lh).
 * The layout is fluid: any extra space is given to the layout, not to a bigger scale.
 */
export function applyCssScale(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const s = fitScale(w, h);
  const root = document.documentElement.style;
  root.setProperty("--s", String(s));
  root.setProperty("--lw", String(Math.max(BASE_W, Math.floor(w / s))));
  root.setProperty("--lh", String(Math.max(BASE_H, Math.floor(h / s))));
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