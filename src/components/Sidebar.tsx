import { useTranslation } from "react-i18next";
import { useNavStore, type View } from "../state/navStore";
import { AnimSprite } from "./AnimSprite";
import { ImportBox } from "./ImportBox";
import { Mascot } from "./Mascot";
import { PixelButton } from "./PixelButton";
import { PixelPanel } from "./PixelPanel";
import { Sprite } from "./Sprite";

const ITEMS: ReadonlyArray<readonly [View, string]> = [
  ["library", "icon-note"],
  ["playlists", "icon-star"],
  ["stats", "icon-list"],
  ["settings", "icon-sliders"],
];

export function Sidebar() {
  const { t } = useTranslation();
  const view = useNavStore((s) => s.view);
  const go = useNavStore((s) => s.go);

  return (
    <PixelPanel className="sidebar">
      <nav className="nav" aria-label={t("app.title")}>
        {ITEMS.map(([id, icon]) => (
          <PixelButton
            key={id}
            variant="nav"
            className="nav-item"
            active={view === id}
            onClick={() => go(id)}
          >
            <Sprite name={icon} w={9} h={9} />
            <span className="ellipsis">{t(`nav.${id}`)}</span>
          </PixelButton>
        ))}
      </nav>

      <div className="divider" aria-hidden="true">
        <i className="divider__line" />
        <AnimSprite name="twinkle-5" w={5} h={5} frames={5} fps={8} />
        <Sprite name="deco-heart" w={9} h={8} />
        <AnimSprite name="twinkle-5" w={5} h={5} frames={5} fps={8} delay={0.3} />
        <i className="divider__line" />
      </div>

      <ImportBox />

      <div className="sidebar__wings">
        <Mascot />
      </div>
    </PixelPanel>
  );
}