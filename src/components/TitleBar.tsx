import { closeWindow, minimizeWindow, toggleMaximizeWindow } from "../ipc/commands";
import { useSettingsStore } from "../state/settingsStore";

export function TitleBar() {
  const alwaysOnTop = useSettingsStore((s) => s.alwaysOnTop);
  const setPinned = useSettingsStore((s) => s.setAlwaysOnTop);

  return (
    <header className="titlebar" data-tauri-drag-region>
      <span className="titlebar__title" data-tauri-drag-region>
        &#9829; cupid player
      </span>
      <div className="titlebar__buttons">
        {/* TEMPORARY: replaced by the Settings view in H4 */}
        <button
          type="button"
          aria-label="Always on top"
          aria-pressed={alwaysOnTop}
          className={alwaysOnTop ? "tb-btn tb-btn--on" : "tb-btn"}
          onClick={() => void setPinned(!alwaysOnTop)}
        >
          pin
        </button>
        <button type="button" aria-label="Minimize" className="tb-btn" onClick={() => void minimizeWindow()}>
          _
        </button>
        <button type="button" aria-label="Maximize" className="tb-btn" onClick={() => void toggleMaximizeWindow()}>
          &#9633;
        </button>
        <button type="button" aria-label="Close" className="tb-btn" onClick={() => void closeWindow()}>
          &#10005;
        </button>
      </div>
    </header>
  );
}