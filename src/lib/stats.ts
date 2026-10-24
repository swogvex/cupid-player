/** `YYYY-MM` of the local date: the same key Rust builds with `month_key_of(Local::now())`. */
export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** The listed months plus the current one, newest first, without duplicates. */
export function mergeMonths(listed: string[], current: string): string[] {
  return [...new Set([current, ...listed])].sort().reverse();
}

/** "33 s", "12 min", "1 h", "1 h 05 min". */
export function formatListened(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, "0")} min`;
}

/** "October 2026" / "Octubre de 2026". Returns the key itself if it is malformed. */
export function monthLabel(key: string, locale: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) return key;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  const text = date.toLocaleDateString(locale, { month: "long", year: "numeric" });
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}