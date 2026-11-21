// ABOUTME: The Presets tab's list and text helpers: cursor moves, type-ahead, word filters and one-line text editing.
// ABOUTME: Pure, driven by KeyPress; kept local so the tab doesn't depend on ui/ for its update logic.

import { type KeyPress, typed } from "../../core/keys.js";

/** The cursor after ↑↓ pgup pgdn home end in a list of `count` rows, `pageRows` to a page; null for other keys. */
export function moveCursor(
  cursor: number,
  key: KeyPress,
  count: number,
  pageRows: number,
): number | null {
  const last = Math.max(0, count - 1);
  const clamp = (n: number) => Math.min(last, Math.max(0, n));
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

/** The next label after the cursor starting with `letter` (wrapping, ignoring case); the cursor when none does. */
export function typeAhead(labels: readonly string[], cursor: number, letter: string): number {
  const wanted = letter.toLowerCase();
  for (let step = 1; step <= labels.length; step++) {
    const index = (cursor + step) % labels.length;
    if (labels[index]?.toLowerCase().startsWith(wanted)) return index;
  }
  return cursor;
}

/** Whether `text` holds every word of `filter`, in any order, ignoring case. */
export function matchesWords(text: string, filter: string, separators: RegExp = /\s+/): boolean {
  const haystack = text.toLowerCase();
  return filter
    .toLowerCase()
    .split(separators)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/** A one-line text being typed, with the cursor as an offset into it. */
export interface TextState {
  value: string;
  cursor: number;
}

/**
 * The text after a key: typing (a burst whole, a burst ending in a newline as typed then entered),
 * backspace, delete, ←/→, home/end. null for keys text doesn't take (enter, esc, ↑↓, ctrl keys…).
 */
export function editText(
  state: TextState,
  key: KeyPress,
): { state: TextState; enter?: true } | null {
  const { value, cursor } = state;
  switch (key.name) {
    case "backspace":
      return cursor > 0
        ? { state: { value: value.slice(0, cursor - 1) + value.slice(cursor), cursor: cursor - 1 } }
        : { state };
    case "delete":
      return { state: { value: value.slice(0, cursor) + value.slice(cursor + 1), cursor } };
    case "left":
      return { state: { value, cursor: Math.max(0, cursor - 1) } };
    case "right":
      return { state: { value, cursor: Math.min(value.length, cursor + 1) } };
    case "home":
      return { state: { value, cursor: 0 } };
    case "end":
      return { state: { value, cursor: value.length } };
  }
  const text = typed(key);
  if (!text) return null;
  const newline = text.search(/[\r\n]/);
  const inserted = newline >= 0 ? text.slice(0, newline) : text;
  const next = {
    value: value.slice(0, cursor) + inserted + value.slice(cursor),
    cursor: cursor + inserted.length,
  };
  return newline >= 0 ? { state: next, enter: true } : { state: next };
}
