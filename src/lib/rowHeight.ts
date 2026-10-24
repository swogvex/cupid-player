/** Row height is 10 logical px; --s is the integer scale written by scale.ts. */
export function estimateRowHeight(): number {
  const s = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--s"));
  return Math.round(10 * (Number.isFinite(s) && s > 0 ? s : 2));
}