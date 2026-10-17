import { useTranslation } from "react-i18next";
import { mockStats } from "../lib/mock";

export function StatsView() {
  const { t } = useTranslation();

  return (
    <section className="view" aria-labelledby="view-stats">
      <header className="view__head">
        <h2 id="view-stats" className="view__title">
          {t("stats.title")}
        </h2>
      </header>
      <div className="stats">
        <div className="stat">
          <span className="muted ellipsis">{t("stats.minutes")}</span>
          <strong className="ellipsis">{mockStats.minutes}</strong>
        </div>
        <div className="stat">
          <span className="muted ellipsis">{t("stats.topArtist")}</span>
          <strong className="ellipsis">{mockStats.topArtist}</strong>
        </div>
        <div className="stat">
          <span className="muted ellipsis">{t("stats.topSong")}</span>
          <strong className="ellipsis">{mockStats.topSong}</strong>
        </div>
      </div>
      <h3 className="view__sub">{t("stats.topSongs")}</h3>
      <ol className="list view__scroll">
        {mockStats.topSongs.map((s, i) => (
          <li key={s.title} className="row">
            <span className="ellipsis">
              {i + 1}. {s.title}
            </span>
            <span className="ellipsis muted">{s.artist}</span>
            <span>{s.plays}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}