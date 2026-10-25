import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import type { Lyrics } from "../ipc/types";
import { formatOffset, seekSecondsForLine } from "../lib/lyricsSync";
import { detectLyricsLang } from "../lib/lyricsText";
import { useActiveLine } from "../lib/useActiveLine";
import { OFFSET_LIMIT_MS, OFFSET_STEP_MS, useLyricsStore } from "../state/lyricsStore";
import { selectCurrent, usePlayerStore } from "../state/playerStore";

/** After the user scrolls by hand, the view stops following the song for this long. */
const FREE_MS = 5000;
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"]);
const KNOWN_ERRORS = new Set([
  "lyrics.unavailable",
  "lyrics.failed",
  "lyrics.db",
  "lyrics.no_track",
]);
/** Shown for empty lines (instrumental breaks). */
const GAP_TEXT = "· · ·";

const prefersReducedMotion = (): boolean =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type MessageAction = { label: string; onClick: () => void; disabled?: boolean };

function Message({ text, action }: { text: string; action?: MessageAction }) {
  return (
    <div className="lyrics__msg-box" role="status">
      <p className="lyrics__msg muted">{text}</p>
      {action && (
        <button
          type="button"
          className="lyrics__btn"
          onClick={action.onClick}
          disabled={action.disabled}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/** Only the two lines whose state changes re-render (memo + stable onSeek). */
const Line = memo(function Line({
  index,
  text,
  active,
  onSeek,
}: {
  index: number;
  text: string;
  active: boolean;
  onSeek: (index: number) => void;
}) {
  return (
    <button
      type="button"
      className={`lyric${active ? " is-active" : ""}`}
      data-i={index}
      // Only the current line is a tab stop; the rest stay reachable by mouse.
      tabIndex={active ? 0 : -1}
      aria-current={active ? "true" : undefined}
      onClick={() => onSeek(index)}
    >
      <span className="lyric__text">{text || GAP_TEXT}</span>
    </button>
  );
});

function SyncedLyrics({ lyrics }: { lyrics: Lyrics }) {
  const { t } = useTranslation();
  const lines = lyrics.lines;
  const offsetMs = useLyricsStore((s) => s.offsetMs);
  const playing = usePlayerStore((s) => s.playing);
  const active = useActiveLine(lines, offsetMs, playing);
  const lang = useMemo(() => detectLyricsLang(lines.map((l) => l.text)), [lines]);

  /** true while the user is browsing by hand: the view does not follow the song. */
  const [free, setFree] = useState(false);
  /** Bumped when the box changes size, to re-center the active line. */
  const [layout, setLayout] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  /** The next placement is instant (first one, or after a resize). */
  const instantNext = useRef(true);

  const stopTimer = useCallback(() => window.clearTimeout(timer.current), []);
  useEffect(() => stopTimer, [stopTimer]);

  const hold = useCallback(() => {
    stopTimer();
    setFree(true);
    timer.current = window.setTimeout(() => setFree(false), FREE_MS);
  }, [stopTimer]);

  const release = useCallback(() => {
    stopTimer();
    setFree(false);
  }, [stopTimer]);

  const seek = useCallback(
    (index: number) => {
      release();
      const offset = useLyricsStore.getState().offsetMs;
      usePlayerStore.getState().seekTo(seekSecondsForLine(lines[index], offset));
    },
    [lines, release],
  );

  // Window or scale changes move the lines: center the active one again, without animation.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      instantNext.current = true;
      setLayout((n) => n + 1);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Keeps the active line in the middle. The first placement is instant (the view may open
  // mid-song); later ones are smooth unless the user prefers reduced motion.
  useEffect(() => {
    if (free) return;
    const el = box.current;
    if (!el) return;
    const row = active >= 0 ? el.querySelector<HTMLElement>(`[data-i="${active}"]`) : null;
    const target = row ? row.offsetTop - (el.clientHeight - row.offsetHeight) / 2 : 0;
    const instant = instantNext.current || prefersReducedMotion();
    instantNext.current = false;
    el.scrollTo({ top: Math.max(0, target), behavior: instant ? "auto" : "smooth" });
  }, [active, free, layout]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (SCROLL_KEYS.has(e.key)) hold();
  };

  return (
    <div className="lyrics">
      <div
        ref={box}
        className="view__scroll lyrics__box"
        lang={lang}
        onWheel={hold}
        onTouchMove={hold}
        onKeyDown={onKeyDown}
        // A press on the box itself (not on a line) is the scrollbar.
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) hold();
        }}
      >
        {lines.map((line, i) => (
          <Line key={i} index={i} text={line.text} active={i === active} onSeek={seek} />
        ))}
      </div>
      {free && (
        <button type="button" className="lyrics__btn lyrics__back" onClick={release}>
          {t("lyrics.backToLine")}
        </button>
      )}
    </div>
  );
}

function PlainLyrics({ text }: { text: string }) {
  const { t } = useTranslation();
  const lang = useMemo(() => detectLyricsLang(text.split("\n")), [text]);
  return (
    <div className="view__scroll lyrics__plain" lang={lang}>
      <p className="lyrics__hint muted">{t("lyrics.unsynced")}</p>
      <p className="lyrics__plain-text">{text}</p>
    </div>
  );
}

/** Shift buttons (synced lyrics only) and "search again" (synced and plain). */
function LyricsTools({
  lyrics,
  busy,
  onRefresh,
}: {
  lyrics: Lyrics;
  busy: boolean;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const offsetMs = useLyricsStore((s) => s.offsetMs);
  const nudge = useLyricsStore((s) => s.nudgeOffset);
  const setOffset = useLyricsStore((s) => s.setOffset);
  const synced = lyrics.status === "synced";
  const canRefresh = synced || lyrics.status === "plain";
  if (!canRefresh) return null;

  return (
    <div className="lyrics__tools">
      {synced && (
        <>
          <button
            type="button"
            className="lyrics__btn lyrics__btn--sm"
            onClick={() => nudge(-OFFSET_STEP_MS)}
            disabled={offsetMs <= -OFFSET_LIMIT_MS}
            aria-label={t("lyrics.earlier")}
            title={t("lyrics.earlier")}
          >
            -
          </button>
          <button
            type="button"
            className="lyrics__btn lyrics__btn--sm lyrics__offset"
            onClick={() => setOffset(0)}
            disabled={offsetMs === 0}
            aria-label={t("lyrics.resetOffset")}
            title={t("lyrics.resetOffset")}
          >
            {formatOffset(offsetMs)}
          </button>
          <button
            type="button"
            className="lyrics__btn lyrics__btn--sm"
            onClick={() => nudge(OFFSET_STEP_MS)}
            disabled={offsetMs >= OFFSET_LIMIT_MS}
            aria-label={t("lyrics.later")}
            title={t("lyrics.later")}
          >
            +
          </button>
        </>
      )}
      <button
        type="button"
        className="lyrics__btn lyrics__btn--sm"
        onClick={onRefresh}
        disabled={busy}
      >
        {t("lyrics.searchAgain")}
      </button>
    </div>
  );
}

export function LyricsView() {
  const { t } = useTranslation();
  const trackId = usePlayerStore((s) => selectCurrent(s)?.id ?? null);
  const load = useLyricsStore((s) => s.load);
  const storeTrack = useLyricsStore((s) => s.trackId);
  const phase = useLyricsStore((s) => s.phase);
  const stored = useLyricsStore((s) => s.lyrics);
  const error = useLyricsStore((s) => s.error);

  // Lyrics are only fetched while this view is open. The store keeps the last answer,
  // so reopening for the same song is instant.
  useEffect(() => {
    load(trackId);
  }, [trackId, load]);

  // Never show the previous song's lyrics (or error) for the current one.
  const lyrics =
    storeTrack === trackId && stored !== null && stored.trackId === trackId ? stored : null;

  let body: ReactNode;
  if (trackId === null) {
    body = <Message text={t("player.nothingPlaying")} />;
  } else if (storeTrack === trackId && phase === "error") {
    const key = error !== null && KNOWN_ERRORS.has(error) ? `errors.${error}` : "errors.unknown";
    body = <Message text={t(key)} action={{ label: t("lyrics.retry"), onClick: () => load(trackId) }} />;
  } else if (lyrics === null) {
    body = <Message text={t("lyrics.loading")} />;
  } else if (lyrics.status === "synced") {
    body = <SyncedLyrics key={lyrics.trackId} lyrics={lyrics} />;
  } else if (lyrics.status === "plain") {
    body = <PlainLyrics text={lyrics.plain ?? ""} />;
  } else if (lyrics.status === "instrumental") {
    body = <Message text={t("lyrics.instrumental")} />;
  } else {
    body = (
      <Message
        text={t("lyrics.notFound")}
        action={{
          label: t("lyrics.searchAgain"),
          onClick: () => load(trackId, true),
          disabled: phase === "loading",
        }}
      />
    );
  }

  return (
    <section className="view" aria-labelledby="view-lyrics">
      <header className="view__head">
        <h2 id="view-lyrics" className="view__title">
          {t("lyrics.title")}
        </h2>
        {lyrics !== null && trackId !== null && (
          <LyricsTools
            lyrics={lyrics}
            busy={phase === "loading"}
            onRefresh={() => load(trackId, true)}
          />
        )}
      </header>
      {body}
    </section>
  );
}