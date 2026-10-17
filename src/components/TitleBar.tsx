import { useTranslation } from "react-i18next";
import { closeWindow, minimizeWindow, toggleMaximizeWindow } from "../ipc/commands";
import { AnimSprite } from "./AnimSprite";
import { Sprite } from "./Sprite";

type WinButtonProps = { icon: string; label: string; onClick: () => void };

function WinButton({ icon, label, onClick }: WinButtonProps) {
  return (
    <button type="button" className="win-btn" aria-label={label} title={label} onClick={onClick}>
      <Sprite name={icon} w={7} h={7} />
    </button>
  );
}

export function TitleBar() {
  const { t } = useTranslation();

  return (
    <header className="titlebar" data-tauri-drag-region>
      <span className="titlebar__title" data-tauri-drag-region>
        <Sprite name="heart-8" w={8} h={8} />
        {t("app.title")}
      </span>

      <div className="titlebar__center" aria-hidden="true">
        <AnimSprite name="twinkle-7" w={7} h={7} frames={8} fps={8} />
        <Sprite name="deco-star" w={11} h={11} />
        <div className="bow">
          <Sprite name="bow-40x16" w={40} h={16} />
          <AnimSprite name="glint-7" w={7} h={7} frames={21} fps={8} className="bow__glint bow__glint--l" />
          <AnimSprite
            name="glint-7"
            w={7}
            h={7}
            frames={21}
            fps={8}
            delay={1.3}
            className="bow__glint bow__glint--r"
          />
        </div>
        <Sprite name="deco-star" w={11} h={11} />
        <AnimSprite name="twinkle-7" w={7} h={7} frames={8} fps={8} delay={0.5} />
      </div>

      <div className="titlebar__buttons">
        <WinButton icon="win-icon-min" label={t("window.minimize")} onClick={() => void minimizeWindow()} />
        <WinButton icon="win-icon-max" label={t("window.maximize")} onClick={() => void toggleMaximizeWindow()} />
        <WinButton icon="win-icon-close" label={t("window.close")} onClick={() => void closeWindow()} />
      </div>
    </header>
  );
}