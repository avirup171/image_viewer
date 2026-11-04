import type { KeyboardEvent } from "react";

/**
 * ⌫ / Delete on a focused recent folder (or its × button) removes it from the
 * list. It must stop the event: App's window listener uses the same keys for
 * "Move to Trash" on the selected image. React's stopPropagation stops the
 * native event at the root element, so it never reaches the window.
 */
export const removeOnDelete = (remove: () => void) => (e: KeyboardEvent<HTMLElement>) => {
  if (e.key !== "Delete" && e.key !== "Backspace") return;
  e.preventDefault();
  e.stopPropagation();
  remove();
};
