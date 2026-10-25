import { useCallback, useSyncExternalStore } from "react";
import * as engine from "../audio/engine";
import type { LyricsLine } from "../ipc/types";
import { activeLineIndex } from "./lyricsSync";

const noop = () => undefined;

/**
 * Index of the line being sung (-1 before the first), following the audio clock.
 * The component re-renders only when the line changes. While playing, a
 * requestAnimationFrame loop only re-checks the index; paused, the audio events
 * (seek, position change) are enough. Nothing runs once the component unmounts.
 * Not unit-tested on purpose: it needs the real <audio> engine (see D-120);
 * the logic lives in lyricsSync.ts.
 */
export function useActiveLine(
  lines: readonly LyricsLine[],
  offsetMs: number,
  playing: boolean,
): number {
  const subscribe = useCallback(
    (notify: () => void) => {
      const off = engine.subscribe({
        time: notify,
        state: noop,
        started: noop,
        ended: noop,
        error: noop,
      });
      let raf = 0;
      const loop = () => {
        notify();
        raf = requestAnimationFrame(loop);
      };
      if (playing) raf = requestAnimationFrame(loop);
      return () => {
        cancelAnimationFrame(raf);
        off();
      };
    },
    [playing],
  );

  const getSnapshot = useCallback(
    () => activeLineIndex(lines, engine.position() * 1000, offsetMs),
    [lines, offsetMs],
  );

  return useSyncExternalStore(subscribe, getSnapshot);
}