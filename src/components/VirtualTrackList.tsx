import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef } from "react";
import type { Track } from "../ipc/types";
import { TrackRow } from "./TrackRow";

type Props = {
  tracks: Track[];
  onPlay: (track: Track) => void;
  /** When this value changes the list scrolls back to the top (e.g. a new search). */
  resetKey?: string;
};

/** Row height is 10 logical px; --s is the integer scale written by scale.ts. */
function estimateRowHeight(): number {
  const s = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--s"));
  return Math.round(10 * (Number.isFinite(s) && s > 0 ? s : 2));
}

export function VirtualTrackList({ tracks, onPlay, resetKey }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: estimateRowHeight,
    getItemKey: (i) => tracks[i].id,
    overscan: 8,
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [resetKey]);

  return (
    <div ref={scrollRef} className="view__scroll">
      <ul className="list list--virtual" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const tr = tracks[item.index];
          return (
            <TrackRow
              key={item.key}
              track={tr}
              index={item.index}
              total={tracks.length}
              rowRef={virtualizer.measureElement}
              style={{ transform: `translateY(${item.start}px)` }}
              onPlay={onPlay}
            />
          );
        })}
      </ul>
    </div>
  );
}