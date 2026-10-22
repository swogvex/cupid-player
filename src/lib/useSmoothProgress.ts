import { useEffect, useRef, type RefObject } from "react";

const EASE_MS = 350; // time constant for catching up with the real progress
const FINISH_EASE_MS = 120; // faster when the work is complete
const CREEP_MS = 5000; // very slow advance while waiting for news
const MAX_STEP_MS = 250; // ignore long pauses (hidden window) instead of jumping

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * One animation step. Eases toward `target` (the real progress), creeps slowly
 * up to `headroom` beyond it while waiting, and never goes backwards.
 */
export function stepProgress(shown: number, target: number, dtMs: number, headroom: number): number {
  const dt = Math.min(Math.max(Number.isFinite(dtMs) ? dtMs : 0, 0), MAX_STEP_MS);
  const goal = Number.isFinite(target) ? clamp01(target) : shown;
  let next = shown;
  if (goal > next) {
    const ease = goal >= 1 ? FINISH_EASE_MS : EASE_MS;
    next += (goal - next) * (1 - Math.exp(-dt / ease));
  }
  if (goal < 1 && headroom > 0) {
    const ceiling = Math.min(goal + headroom, 0.99);
    if (ceiling > next) next += (ceiling - next) * (1 - Math.exp(-dt / CREEP_MS));
  }
  if (goal >= 1 && next > 0.999) return 1;
  return clamp01(Math.max(shown, next));
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Animates the `--p` custom property (0..1) of `barRef` toward `target`.
 * It writes to the DOM directly, so React does not re-render every frame.
 * `runId` changes with every new import and restarts the bar from the left.
 */
export function useSmoothProgress(
  barRef: RefObject<HTMLElement | null>,
  target: number,
  active: boolean,
  headroom: number,
  runId: number,
): void {
  const shownRef = useRef(0);
  const runRef = useRef(runId);

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    if (runRef.current !== runId) {
      runRef.current = runId;
      shownRef.current = 0;
      el.style.setProperty("--p", "0");
    }
    if (!active || prefersReducedMotion()) {
      shownRef.current = target;
      el.style.setProperty("--p", String(target));
      return;
    }

    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const shown = stepProgress(shownRef.current, target, now - last, headroom);
      shownRef.current = shown;
      last = now;
      el.style.setProperty("--p", String(shown));
      const settled = target >= 1 ? shown >= 1 : headroom <= 0 && Math.abs(shown - target) < 0.0005;
      if (!settled) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [barRef, target, active, headroom, runId]);
}