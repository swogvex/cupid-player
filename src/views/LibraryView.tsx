import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PixelInput } from "../components/PixelInput";
import { TrackRow } from "../components/TrackRow";
import { mockTracks } from "../lib/mock";

export function LibraryView() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const tracks = useMemo(
    () =>
      q === ""
        ? mockTracks
        : mockTracks.filter((tr) => `${tr.title} ${tr.artist} ${tr.album}`.toLowerCase().includes(q)),
    [q],
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
      {tracks.length === 0 ? (
        <p className="muted">{t("library.empty")}</p>
      ) : (
        <ul className="list view__scroll">
          {tracks.map((tr) => (
            <TrackRow key={tr.id} track={tr} />
          ))}
        </ul>
      )}
    </section>
  );
}