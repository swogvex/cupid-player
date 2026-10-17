import type { HTMLAttributes } from "react";

type PixelPanelProps = HTMLAttributes<HTMLDivElement> & {
  /** Adds the four corner ornaments. */
  deco?: boolean;
};

export function PixelPanel({ className = "", deco = false, children, ...rest }: PixelPanelProps) {
  const cls = ["px-panel", deco ? "px-panel--deco" : "", className].filter(Boolean).join(" ");
  return (
    <div className={cls} {...rest}>
      {deco && (
        <>
          <i className="px-corner px-corner--tl" aria-hidden="true" />
          <i className="px-corner px-corner--tr" aria-hidden="true" />
          <i className="px-corner px-corner--bl" aria-hidden="true" />
          <i className="px-corner px-corner--br" aria-hidden="true" />
        </>
      )}
      {children}
    </div>
  );
}