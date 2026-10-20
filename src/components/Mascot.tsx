import { useLayoutEffect, useRef, useState } from "react";
import { hasSprite, spriteInfo } from "../lib/sprites";
import { useSettingsStore } from "../state/settingsStore";
import { Sprite } from "./Sprite";
import { WingedHeart } from "./WingedHeart";

type Variant = "full" | "compact";

/** Layers of one mascot, bottom to top. All share the same canvas, so they stack at (0, 0). */
const LAYERS = ["back", "body", "tail", "ears", "front", "hearts", "sparks"] as const;

/** Sidebar mascot: the theme's sleeping animal, compact or full depending on the free height. */
export function Mascot() {
  const theme = useSettingsStore((s) => s.theme);
  const hostRef = useRef<HTMLDivElement>(null);
  const [variant, setVariant] = useState<Variant | null>(null);
  const supported = hasSprite(theme, "mascot-compact-back");
  const fullH = spriteInfo(theme, "mascot-full-back")?.h;

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !supported) return;
    const measure = () => {
      const scale = parseFloat(getComputedStyle(host).getPropertyValue("--s")) || 2;
      const free = host.clientHeight / scale;
      setVariant(fullH !== undefined && free >= fullH ? "full" : "compact");
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [supported, fullH]);

  // Themes without their own mascot yet keep the winged heart.
  if (!supported) return <WingedHeart />;

  const prefix = variant === "full" ? "mascot-full" : "mascot-compact";
  const base = variant ? spriteInfo(theme, `${prefix}-back`) : undefined;

  return (
    <div ref={hostRef} className="mascot-host">
      {variant && base && (
        <div
          className="mascot"
          style={{ width: `calc(var(--s) * ${base.w}px)`, height: `calc(var(--s) * ${base.h}px)` }}
        >
          {LAYERS.map((layer) => (
            <span key={layer} className="mascot__layer">
              <Sprite name={`${prefix}-${layer}`} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}