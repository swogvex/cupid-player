import type { LyricsLine } from "../ipc/types";

/** Seeking lands this far after a line starts, so the clicked line is the active one
 *  even if the audio decoder rounds the position down a little. */
export const SEEK_MARGIN_MS = 30;

/**
 * Index of the line being sung at `positionMs`, or -1 before the first line.
 * `lines` must be sorted by `ms` (Rust sorts them). `offsetMs` > 0 shows the lyrics later.
 * Binary search: cheap enough to call every frame.
 */
export function activeLineIndex(
  lines: readonly LyricsLine[],
  positionMs: number,
  offsetMs = 0,
): number {
  const t = positionMs - offsetMs;
  if (lines.length === 0 || !Number.isFinite(t)) return -1;
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].ms <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** Audio position (seconds) that makes `line` the active one. Never negative. */
export function seekSecondsForLine(line: LyricsLine, offsetMs = 0): number {
  return Math.max(0, (line.ms + offsetMs + SEEK_MARGIN_MS) / 1000);
}

/** "+0.5s", "-1.5s" or "0.0s". ASCII only, so any pixel font can draw it. */
export function formatOffset(offsetMs: number): string {
  const seconds = Math.round(offsetMs / 100) / 10;
  const text = Math.abs(seconds).toFixed(1);
  if (seconds > 0) return `+${text}s`;
  if (seconds < 0) return `-${text}s`;
  return `${text}s`;
}