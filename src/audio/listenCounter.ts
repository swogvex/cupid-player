/**
 * Counts how long a track is really heard (H9). Pure logic: no Tauri, no DOM, no stores,
 * so it can be tested in Node. `listenTracker.ts` connects it to the app.
 *
 * Time is measured on the audio position: it only grows while sound actually plays, and
 * pauses, seeks, buffering and system sleep add nothing.
 */

/** A track must be heard this long before anything is saved (skipped songs leave no trace). */
export const MIN_SECONDS = 5;
/** How often the heard time is saved while a song plays. */
export const CHECKPOINT_MS = 30_000;
/** Largest forward step between two position updates that still counts as playback. */
const MAX_STEP_SECONDS = 2;

export interface ListenDeps {
  startPlay: (trackId: number) => Promise<number>;
  updatePlay: (playId: number, seconds: number) => Promise<boolean>;
}

export interface ListenCounter {
  /** The current track changed (null = nothing loaded). Saves the previous session. */
  setTrack: (trackId: number | null) => void;
  setPlaying: (playing: boolean) => void;
  /** Audio position in seconds, from the engine's time updates. */
  tick: (position: number) => void;
  /** Ends the current session (song ended, window closing) and saves it. */
  finish: () => void;
  /** Saves what has been heard so far. */
  checkpoint: () => void;
  /** Resolves when every pending save has finished (for tests). */
  idle: () => Promise<void>;
}

interface Session {
  trackId: number;
  /** Seconds heard so far (fractional). */
  heard: number;
  /** Row id in `plays`; null until `startPlay` succeeds. */
  playId: number | null;
  /** Whole seconds already stored. */
  sent: number;
  /** The 5 s threshold was reached and the first save was requested. */
  opened: boolean;
  /** The row is gone (its track was deleted): stop saving. */
  dead: boolean;
}

export function createListenCounter(deps: ListenDeps): ListenCounter {
  let trackId: number | null = null;
  let session: Session | null = null;
  let playing = false;
  let lastPosition: number | null = null;
  // Saves run one after another, so `update_play` never overtakes `start_play`.
  let chain: Promise<void> = Promise.resolve();

  const freshSession = (): Session | null =>
    trackId === null
      ? null
      : { trackId, heard: 0, playId: null, sent: 0, opened: false, dead: false };

  const enqueue = (s: Session, seconds: number): void => {
    chain = chain.then(async () => {
      if (s.dead) return;
      try {
        if (s.playId === null) {
          if (seconds < MIN_SECONDS) return;
          s.playId = await deps.startPlay(s.trackId);
        }
        if (seconds > s.sent) {
          const exists = await deps.updatePlay(s.playId, seconds);
          if (exists) s.sent = seconds;
          else s.dead = true;
        }
      } catch {
        // Best effort: a failed save must never disturb playback. The next one retries.
      }
    });
  };

  const sync = (): void => {
    if (!session) return;
    const seconds = Math.floor(session.heard);
    const minimum = session.playId === null ? MIN_SECONDS : 1;
    if (seconds >= minimum && seconds > session.sent) enqueue(session, seconds);
  };

  return {
    setTrack: (id) => {
      if (id === trackId) return;
      sync();
      trackId = id;
      session = freshSession();
      lastPosition = null;
    },

    setPlaying: (value) => {
      playing = value;
      if (value) lastPosition = null;
      else sync();
    },

    tick: (position) => {
      if (!session || !playing) {
        lastPosition = position; // keep the baseline fresh while paused
        return;
      }
      if (lastPosition !== null) {
        const step = position - lastPosition;
        if (step > 0 && step <= MAX_STEP_SECONDS) session.heard += step;
      }
      lastPosition = position;
      if (!session.opened && Math.floor(session.heard) >= MIN_SECONDS) {
        session.opened = true;
        sync();
      }
    },

    finish: () => {
      sync();
      session = freshSession();
      lastPosition = null;
    },

    checkpoint: sync,

    idle: () => chain,
  };
}