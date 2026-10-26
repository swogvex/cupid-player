import type { Wrapped } from "../ipc/types";

export type SlideKind =
  | "intro"
  | "minutes"
  | "artist"
  | "song"
  | "month"
  | "artists"
  | "songs"
  | "outro";

/** The slides to show, in order. Empty when the year has no listening (empty state instead). */
export function buildSlides(w: Wrapped): SlideKind[] {
  if (w.months.length === 0) return [];
  const slides: SlideKind[] = ["intro", "minutes"];
  if (w.topArtists.length > 0) slides.push("artist");
  if (w.topTracks.length > 0) slides.push("song");
  if (w.topMonth !== null) slides.push("month");
  if (w.topArtists.length > 0) slides.push("artists");
  if (w.topTracks.length > 0) slides.push("songs");
  slides.push("outro");
  return slides;
}

/** Keeps a slide index inside 0..length-1 (0 when there are no slides). */
export function clampSlide(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(Math.max(index, 0), length - 1);
}

/** Years that can have a Wrapped: the years of the listed months plus the current one, newest first. */
export function wrappedYears(listedMonths: string[], currentYear: number): number[] {
  const years = new Set<number>([currentYear]);
  for (const key of listedMonths) {
    if (/^\d{4}-\d{2}$/.test(key)) years.add(Number(key.slice(0, 4)));
  }
  return [...years].sort((a, b) => b - a);
}

/** "October" / "Octubre" from a "YYYY-MM" key. Returns the key itself if it is malformed. */
export function monthName(key: string, locale: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) return key;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  const text = date.toLocaleDateString(locale, { month: "long" });
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

/** The Wrapped link is highlighted in December. */
export function isDecember(now: Date = new Date()): boolean {
  return now.getMonth() === 11;
}