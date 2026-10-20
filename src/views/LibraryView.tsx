import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PixelInput } from "../components/PixelInput";
import { TrackRow } from "../components/TrackRow";
import { useLibraryStore } from "../state/libraryStore";
import { usePlayerStore } from "../state/playerStore";

export function LibraryView() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const tracks = useLibraryStore((s) => s.tracks);
  const error = useLibraryStore((s) => s.error);
  const q = query.trim().toLowerCase();

  const visibleTracks = useMemo(
    () =>
      q === ""
        ? tracks
        : tracks.filter((tr) => `${tr.title} ${tr.artist} ${tr.album ?? ""}`.toLowerCase().includes(q)),
    [q, tracks],
  );

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
        <ul className="list view__scroll">
          {visibleTracks.map((tr) => (
            <TrackRow
              key={tr.id}
              track={tr}
              onPlay={(picked) => usePlayerStore.getState().playTracks(visibleTracks, picked.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}