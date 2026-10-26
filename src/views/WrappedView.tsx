import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Marquee } from "../components/Marquee";
import { PixelButton } from "../components/PixelButton";
import { Sprite } from "../components/Sprite";
import { getWrapped, listStatMonths } from "../ipc/commands";
import type { Wrapped } from "../ipc/types";
import { formatListened } from "../lib/stats";
import { buildSlides, clampSlide, monthName, wrappedYears, type SlideKind } from "../lib/wrapped";
import { useNavStore } from "../state/navStore";
import "../styles/wrapped.css";

const KNOWN_ERRORS = new Set(["stats.bad_year", "stats.db"]);

interface SlideProps {
  kind: SlideKind;
  data: Wrapped;
  locale: string;
  onReplay: () => void;
}

function Slide({ kind, data, locale, onReplay }: SlideProps) {
  const { t } = useTranslation();
  const number = new Intl.NumberFormat(locale);
  const artist = data.topArtists[0];
  const song = data.topTracks[0];

  switch (kind) {
    case "intro":
      return (
        <>
          <Sprite name="deco-heart" w={9} h={8} />
          <span className="wrapped__kicker">{t("wrapped.introKicker")}</span>
          <strong className="wrapped__big ellipsis">{t("wrapped.introTitle", { year: data.year })}</strong>
          <span className="wrapped__kicker">{t("wrapped.hint")}</span>
        </>
      );
    case "minutes":
      return (
        <>
          <span className="wrapped__kicker">{t("wrapped.minutesLabel")}</span>
          <strong className="wrapped__big ellipsis">{number.format(data.minutes)}</strong>
          {data.minutes >= 60 && <span>{formatListened(data.minutes * 60)}</span>}
        </>
      );
    case "artist":
      return (
        <>
          <span className="wrapped__kicker">{t("wrapped.artistLabel")}</span>
          <Marquee text={artist?.artist ?? ""} always className="wrapped__big" />
          <span>{formatListened(artist?.seconds ?? 0)}</span>
        </>
      );
    case "song":
      return (
        <>
          <span className="wrapped__kicker">{t("wrapped.songLabel")}</span>
          <Marquee text={song?.title ?? ""} always className="wrapped__big" />
          <Marquee text={song?.artist ?? ""} always />
          <span className="wrapped__kicker">
            {formatListened(song?.seconds ?? 0)} · {t("stats.plays", { count: song?.plays ?? 0 })}
          </span>
        </>
      );
    case "month":
      return (
        <>
          <span className="wrapped__kicker">{t("wrapped.monthLabel")}</span>
          <strong className="wrapped__big ellipsis">
            {monthName(data.topMonth?.monthKey ?? "", locale)}
          </strong>
          <span>{formatListened((data.topMonth?.minutes ?? 0) * 60)}</span>
        </>
      );
    case "artists":
      return (
        <>
          <span className="wrapped__kicker">{t("wrapped.topArtists")}</span>
          <ol className="wrapped__rank">
            {data.topArtists.map((a, i) => (
              <li key={`${i}-${a.artist}`} className="wrapped__row" data-marquee-host>
                <span className="wrapped__pos">{i + 1}</span>
                <Marquee text={a.artist} />
                <span className="wrapped__time">{formatListened(a.seconds)}</span>
              </li>
            ))}
          </ol>
        </>
      );
    case "songs":
      return (
        <>
          <span className="wrapped__kicker">{t("wrapped.topSongs")}</span>
          <ol className="wrapped__rank">
            {data.topTracks.map((s, i) => (
              <li
                key={`${i}-${s.title}-${s.artist}`}
                className="wrapped__row wrapped__row--song"
                data-marquee-host
                title={t("stats.plays", { count: s.plays })}
              >
                <span className="wrapped__pos">{i + 1}</span>
                <Marquee text={s.title} />
                <span className="muted">
                  <Marquee text={s.artist} />
                </span>
                <span className="wrapped__time">{formatListened(s.seconds)}</span>
              </li>
            ))}
          </ol>
        </>
      );
    case "outro":
      return (
        <>
          <Sprite name="deco-heart" w={9} h={8} />
          <strong className="wrapped__big ellipsis">{t("wrapped.outroTitle", { year: data.year })}</strong>
          <span className="wrapped__kicker">{t("wrapped.outroText")}</span>
          <PixelButton onClick={onReplay}>{t("wrapped.replay")}</PixelButton>
        </>
      );
  }
}

export function WrappedView() {
  const { t, i18n } = useTranslation();
  const closeWrapped = useNavStore((s) => s.closeWrapped);
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [years, setYears] = useState<number[]>(() => [currentYear]);
  const [data, setData] = useState<Wrapped | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const rootRef = useRef<HTMLElement>(null);
  const locale = i18n.resolvedLanguage ?? i18n.language;

  // Years with listening, for the year selector.
  useEffect(() => {
    let cancelled = false;
    listStatMonths()
      .then((listed) => {
        if (!cancelled) setYears(wrappedYears(listed, currentYear));
      })
      .catch(() => {
        // The selector keeps just the current year; the error surfaces in getWrapped if real.
      });
    return () => {
      cancelled = true;
    };
  }, [currentYear]);

  useEffect(() => {
    let cancelled = false;
    getWrapped(year)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setErrorCode(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setErrorCode(typeof e === "string" ? e : "unknown");
      });
    return () => {
      cancelled = true;
    };
  }, [year]);

  // Focus the view so the arrow keys work right away.
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  // Do not show the previous year's numbers while the new year loads.
  const shown = data !== null && data.year === year ? data : null;
  const slides = shown ? buildSlides(shown) : [];
  const current = clampSlide(index, slides.length);
  const empty = shown !== null && slides.length === 0;

  const step = (delta: number) => setIndex((i) => clampSlide(i + delta, slides.length));

  const position = years.indexOf(year);
  const olderYear = position >= 0 ? years[position + 1] : undefined;
  const newerYear = position > 0 ? years[position - 1] : undefined;
  const goYear = (target: number | undefined) => {
    if (target === undefined) return;
    setYear(target);
    setIndex(0);
  };

  // The arrows also seek inside the song globally: here they only move the slides.
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "ArrowRight") step(1);
    else if (e.key === "ArrowLeft") step(-1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const kind = slides[current];

  return (
    <section
      ref={rootRef}
      className="view wrapped"
      aria-labelledby="view-wrapped"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <header className="view__head view__head--back">
        <PixelButton onClick={closeWrapped}>{t("common.back")}</PixelButton>
        <h2 id="view-wrapped" className="view__title ellipsis">
          {t("wrapped.title")}
        </h2>
        <div className="month-nav">
          <button
            type="button"
            className="month-nav__btn"
            onClick={() => goYear(olderYear)}
            disabled={olderYear === undefined}
            aria-label={t("wrapped.prevYear")}
          >
            &lt;
          </button>
          <span className="month-nav__label">{year}</span>
          <button
            type="button"
            className="month-nav__btn"
            onClick={() => goYear(newerYear)}
            disabled={newerYear === undefined}
            aria-label={t("wrapped.nextYear")}
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
      {empty && <p className="stats__empty muted">{t("wrapped.empty", { year })}</p>}
      {shown !== null && kind !== undefined && (
        <>
          <div className="wrapped__stage">
            <button
              type="button"
              className="month-nav__btn"
              onClick={() => step(-1)}
              disabled={current === 0}
              aria-label={t("wrapped.prev")}
            >
              &lt;
            </button>
            <div
              key={kind}
              className="wrapped__slide"
              aria-live="polite"
              aria-label={t("wrapped.slide", { n: current + 1, total: slides.length })}
            >
              <Slide
                kind={kind}
                data={shown}
                locale={locale}
                onReplay={() => setIndex(0)}
              />
            </div>
            <button
              type="button"
              className="month-nav__btn"
              onClick={() => step(1)}
              disabled={current === slides.length - 1}
              aria-label={t("wrapped.next")}
            >
              &gt;
            </button>
          </div>
          <div className="wrapped__dots">
            {slides.map((k, i) => (
              <button
                key={k}
                type="button"
                className="wrapped__dot"
                aria-current={i === current}
                aria-label={t("wrapped.slide", { n: i + 1, total: slides.length })}
                onClick={() => setIndex(i)}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}