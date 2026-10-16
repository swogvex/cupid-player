import { useEffect } from "react";
import { TitleBar } from "./components/TitleBar";
import { startScaleTracking, type Scale } from "./lib/scale";
import { useSettingsStore } from "./state/settingsStore";

const SCALES: Scale[] = [2, 3, 4];

export default function App() {
  const init = useSettingsStore((s) => s.init);
  const scale = useSettingsStore((s) => s.scale);
  const alwaysOnTop = useSettingsStore((s) => s.alwaysOnTop);
  const setScale = useSettingsStore((s) => s.setScale);

  useEffect(() => {
    void init();
    return startScaleTracking((n) => void useSettingsStore.getState().setScale(n));
  }, [init]);

  return (
    <div className="letterbox">
      <div className="frame">
        <TitleBar />
        <main className="content">
          {/* TEMPORARY test UI: replaced by Settings in H4 */}
          <p>
            H2 test - scale x{scale} - always on top: {alwaysOnTop ? "yes" : "no"}
          </p>
          <div className="scale-row">
            {SCALES.map((n) => (
              <button
                key={n}
                type="button"
                className={n === scale ? "tb-btn tb-btn--on" : "tb-btn"}
                onClick={() => void setScale(n)}
              >
                x{n}
              </button>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}