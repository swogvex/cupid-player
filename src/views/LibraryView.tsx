import { useDeferredValue, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PixelInput } from "../components/PixelInput";
import { VirtualTrackList } from "../components/VirtualTrackList";
import { filterTracks } from "../lib/search";
import { useLibraryStore } from "../state/libraryStore";
import { usePlayerStore } from "../state/playerStore";

export function LibraryView() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const tracks = useLibraryStore((s) => s.tracks);
  // const tracks = rawtracks.length ? Array.from({ length: 5000 }, (_, i) => ({ ...rawtracks[0], id: 100000 + i, title: `Test ${i}` })) : rawtracks;
  const error = useLibraryStore((s) => s.error);

  const visibleTracks = useMemo(() => filterTracks(tracks, deferredQuery), [tracks, deferredQuery]);

  return (
    <section className="view" aria-labelledby="view-library">
      <header className="view__head">
        <h2 id="view-library" className="view__title">
          {t("library.title")}
        </h2>
      </header>
      <PixelInput
        placeholder={t("library.search")}
        aria-label={t("library.search")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
      {error ? (
        <p className="muted">{error}</p>
      ) : visibleTracks.length === 0 ? (
        <p className="muted">{t("library.empty")}</p>
      ) : (
        <VirtualTrackList
          tracks={visibleTracks}
          resetKey={deferredQuery}
          onPlay={(picked) => usePlayerStore.getState().playTracks(visibleTracks, picked.id)}
        />
      )}
    </section>
  );
}