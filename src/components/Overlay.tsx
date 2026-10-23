import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Draws outside the view's stacking context but inside `.shell`, so menus and
 * dialogs cover the player and keep the theme's fonts and --px.
 */
export function Overlay({ children }: { children: ReactNode }) {
  const host = document.querySelector<HTMLElement>(".shell") ?? document.body;
  return createPortal(children, host);
}