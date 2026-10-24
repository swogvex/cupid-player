import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Overlay } from "./Overlay";

type MenuShellProps = {
  x: number;
  y: number;
  label: string;
  onClose: () => void;
  children: ReactNode;
};

/**
 * Floating context menu. Placed inside the window, keyboard navigable (arrows,
 * Home/End), closes on Escape, outside click, resize, blur or wheel.
 */
export function MenuShell({ x, y, label, onClose, children }: MenuShellProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Positioned through the DOM (not state) so it never flashes at the wrong place.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.left = `${Math.max(0, Math.min(x, window.innerWidth - r.width))}px`;
    el.style.top = `${Math.max(0, Math.min(y, window.innerHeight - r.height))}px`;
    el.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
  }, [x, y]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    window.addEventListener("wheel", onClose, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("wheel", onClose);
    };
  }, [onClose]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(i + 1) % items.length].focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length].focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0].focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1].focus();
    } else if (e.key === "Tab") {
      e.preventDefault();
    }
  };

  return (
    <Overlay>
      <div
        ref={ref}
        className="ctx"
        role="menu"
        aria-label={label}
        style={{ left: x, top: y }}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
      >
        {children}
      </div>
    </Overlay>
  );
}

export function MenuItem({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" role="menuitem" className="ctx__item" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="ctx__sep" role="separator" />;
}