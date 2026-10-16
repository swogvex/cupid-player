import { isWindowMaximized } from "../ipc/commands";

export const BASE_W = 352;
export const BASE_H = 208;
export const MIN_SCALE = 2;
export const MAX_SCALE = 4;

export type Scale = 2 | 3 | 4;

/** Integer scale that fits the viewport (floor => letterbox, never blurry). */
export function fitScale(width: number, height: number): number {
  return Math.max(1, Math.floor(Math.min(width / BASE_W, height / BASE_H)));
}

/** Nearest allowed scale (2..4) for a free-resized window. */
export function snapScale(width: number, height: number): Scale {
  const raw = Math.round(Math.min(width / BASE_W, height / BASE_H));
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw)) as Scale;
}

export function applyCssScale(): void {
  const s = fitScale(window.innerWidth, window.innerHeight);
  document.documentElement.style.setProperty("--s", String(s));
}

/**
 * Keeps --s in sync with the window and, 200 ms after the last resize,
 * asks `onSnap` to snap the window to the nearest integer scale.
 * Returns a cleanup function.
 */
export function startScaleTracking(onSnap: (n: Scale) => void): () => void {
  let timer: number | undefined;

  const onResize = () => {
    applyCssScale();
    window.clearTimeout(timer);
    timer = window.setTimeout(async () => {
      if (await isWindowMaximized()) return; // maximized => letterbox only
      const w = window.innerWidth;
      const h = window.innerHeight;
      const n = snapScale(w, h);
      const aligned = Math.abs(w - BASE_W * n) <= 1 && Math.abs(h - BASE_H * n) <= 1;
      if (!aligned) onSnap(n);
    }, 150);
  };

  applyCssScale();
  window.addEventListener("resize", onResize);
  return () => {
    window.clearTimeout(timer);
    window.removeEventListener("resize", onResize);
  };
}