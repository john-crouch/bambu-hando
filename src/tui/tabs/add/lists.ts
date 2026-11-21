// ABOUTME: The Add tab's list and text helpers: cursor moves, type-ahead and single-line editing, all pure.
// ABOUTME: Same shapes as the design system's moveCursor/typeAhead/editText, so they can be swapped for those.

import { type KeyPress, typed } from "../../core/keys.js";

/** The cursor after a move key (↑↓ pgup pgdn home end, no wrap); null when the key isn't one. */
export function moveCursor(
  cursor: number,
  key: KeyPress,
  count: number,
  pageRows: number,
): number | null {
  const last = Math.max(0, count - 1);
  const clamp = (value: number) => Math.max(0, Math.min(value, last));
  switch (key.name) {
    case "up":
      return clamp(cursor - 1);
    case "down":
      return clamp(cursor + 1);
    case "pageUp":
      return clamp(cursor - Math.max(1, pageRows));
    case "pageDown":
      return clamp(cursor + Math.max(1, pageRows));
    case "home":
      return 0;
    case "end":
      return last;
    default:
      return null;
  }
}

/** The next label after the cursor starting with the letter (wrapping, ignoring case); the cursor when none does. */
export function typeAhead(labels: readonly string[], cursor: number, letter: string): number {
  const wanted = letter.toLowerCase();
  for (let step = 1; step <= labels.length; step++) {
    const index = (cursor + step) % labels.length;
    if (labels[index]?.toLowerCase().startsWith(wanted)) return index;
  }
  return cursor;
}

export interface TextState {
  value: string;
  /** Where typing goes, 0 to value.length. */
  cursor: number;
}

export function textState(value: string): TextState {
  return { value, cursor: value.length };
}

/** The text after an editing key (typing, bursts, backspace, delete, ←/→, home/end); null for other keys. */
export function editText(state: TextState, key: KeyPress): TextState | null {
  const { value, cursor } = state;
  switch (key.name) {
    case "left":
      return { value, cursor: Math.max(0, cursor - 1) };
    case "right":
      return { value, cursor: Math.min(value.length, cursor + 1) };
    case "home":
      return { value, cursor: 0 };
    case "end":
      return { value, cursor: value.length };
    case "backspace":
      return cursor === 0
        ? state
        : { value: value.slice(0, cursor - 1) + value.slice(cursor), cursor: cursor - 1 };
    case "delete":
      return { value: value.slice(0, cursor) + value.slice(cursor + 1), cursor };
  }
  const text = typed(key).replace(/[\r\n]/g, "");
  if (!text) return null;
  return {
    value: value.slice(0, cursor) + text + value.slice(cursor),
    cursor: cursor + text.length,
  };
}
