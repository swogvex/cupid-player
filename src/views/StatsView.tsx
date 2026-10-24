import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getStats, listStatMonths } from "../ipc/commands";
import type { MonthStats } from "../ipc/types";
import { currentMonthKey, formatListened, mergeMonths, monthLabel } from "../lib/stats";

/** The open month is re-read this often so the numbers move while music plays. */
const REFRESH_MS = 15_000;
const KNOWN_ERRORS = new Set(["stats.bad_month", "stats.db"]);
const DASH = "—";

export function StatsView() {
  const { t, i18n } = useTranslation();
  const [monthKey, setMonthKey] = useState(() => currentMonthKey());
  const [months, setMonths] = useState<string[]>(() => [currentMonthKey()]);
  const [stats, setStats] = useState<MonthStats | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [listed, data] = await Promise.all([listStatMonths(), getStats(monthKey)]);
        if (cancelled) return;
        setMonths(mergeMonths(listed, currentMonthKey()));
        setStats(data);
        setErrorCode(null);
      } catch (e) {
        if (!cancelled) setErrorCode(typeof e === "string" ? e : "unknown");
      }
    };
    void load();
    // Closed months never change: only the current one is polled.
    const timer =
      monthKey === currentMonthKey() ? window.setInterval(() => void load(), REFRESH_MS) : undefined;
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [monthKey]);

  // Do not show the previous month's numbers while the new month loads.
  const data = stats !== null && stats.monthKey === monthKey ? stats : null;
  const noListening = data !== null && data.topTracks.length === 0;

  const index = months.indexOf(monthKey);
  const older = index >= 0 ? months[index + 1] : undefined;
  const newer = index > 0 ? months[index - 1] : undefined;
  const goOlder = () => {
    if (older) setMonthKey(older);
  };
  const goNewer = () => {
    if (newer) setMonthKey(newer);
  };

  let minutesText = DASH;
  if (data !== null) {
    minutesText = data.minutes === 0 && data.topTracks.length > 0 ? "<1" : String(data.minutes);
  }
  const topArtist = data?.topArtists[0]?.artist ?? DASH;
  const topSong = data?.topTracks[0]?.title ?? DASH;
  const locale = i18n.resolvedLanguage ?? i18n.language;

  return (
    <section className="view" aria-labelledby="view-stats">
      <header className="view__head">
        <h2 id="view-stats" className="view__title">
          {t("stats.title")}
        </h2>
        <div className="month-nav">
          <button
            type="button"
            className="month-nav__btn"
            onClick={goOlder}
            disabled={!older}
            aria-label={t("stats.prevMonth")}
          >
            &lt;
          </button>
          <span className="month-nav__label ellipsis">{monthLabel(monthKey, locale)}</span>
          <button
            type="button"
            className="month-nav__btn"
            onClick={goNewer}
            disabled={!newer}
            aria-label={t("stats.nextMonth")}
          >
            &gt;
          </button>
        </div>
      </header>
      {errorCode !== null && (
        <p className="modal__error">
          {t(KNOWN_ERRORS.has(errorCode) ? `errors.${errorCode}` : "errors.unknown")}
        </p>
      )}
      <div className="stats">
        <div className="stat">
          <span className="muted ellipsis">{t("stats.minutes")}</span>
          <strong className="ellipsis">{minutesText}</strong>
        </div>
        <div className="stat">
          <span className="muted ellipsis">{t("stats.topArtist")}</span>
          <strong className="ellipsis">{topArtist}</strong>
        </div>
        <div className="stat">
          <span className="muted ellipsis">{t("stats.topSong")}</span>
          <strong className="ellipsis">{topSong}</strong>
        </div>
      </div>
      <h3 className="view__sub">{t("stats.topSongs")}</h3>
      {noListening ? (
        <p className="stats__empty muted">{t("stats.emptyMonth")}</p>
      ) : (
        <ol className="list view__scroll">
          {data?.topTracks.map((s, i) => (
            <li
              key={`${i}-${s.title}-${s.artist}`}
              className="row"
              title={t("stats.plays", { count: s.plays })}
            >
              <span className="ellipsis">
                {i + 1}. {s.title}
              </span>
              <span className="ellipsis muted">{s.artist}</span>
              <span>{formatListened(s.seconds)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}