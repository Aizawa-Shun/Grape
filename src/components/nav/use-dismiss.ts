"use client";

import { useEffect, type RefObject } from "react";

/**
 * Closes a popover on Escape or on a press outside it.
 *
 * Both menus in the sidebar need this, and getting only one of the two right
 * is the usual outcome of writing it twice. Escape matters more than it looks:
 * it is the only way to leave these menus from the keyboard.
 */
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  close: () => void,
): void {
  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    function onPointerDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) close();
    }

    document.addEventListener("keydown", onKeyDown);
    // Capture phase, so a press that also triggers something else still closes
    // the menu rather than leaving it open behind the new view.
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [ref, open, close]);
}
