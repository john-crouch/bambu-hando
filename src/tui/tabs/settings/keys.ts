// ABOUTME: Local list and text-field key helpers for the Settings and Check tabs: cursor moves, type-ahead, text editing.
// ABOUTME: Pure, over KeyPress; they mirror the design system's moveCursor/typeAhead/editText so they can be swapped for them.

import { type KeyPress, typed } from "../../core/keys.js";

/** The cursor after ↑ ↓ pgup pgdn home end, kept within [0, count), no wrap; null for other keys. */
export function moveCursor(
  cursor: number,
  key: KeyPress,
  count: number,
  page: number,
): number | null {
  const last = Math.max(0, count - 1);
  const clamp = (value: number): number => Math.max(0, Math.min(value, last));
  switch (key.name) {
    case "up":
      return clamp(cursor - 1);
    case "down":
      return clamp(cursor + 1);
    case "pageUp":
      return clamp(cursor - Math.max(1, page));
    case "pageDown":
      return clamp(cursor + Math.max(1, page));
    case "home":
      return 0;
    case "end":
      return last;
    default:
      return null;
  }
}

/** The next label after the cursor starting with the letter (ignoring case), wrapping around; else the cursor. */
export function typeAhead(labels: string[], cursor: number, letter: string): number {
  const lower = letter.toLowerCase();
  for (let step = 1; step <= labels.length; step++) {
    const index = (cursor + step) % labels.length;
    if (labels[index]?.toLowerCase().startsWith(lower)) return index;
  }
  return cursor;
}

export interface TextState {
  value: string;
  /** Position in value, 0..value.length. */
  cursor: number;
}

/**
 * A text field after a key: typing (a burst too) inserts at the cursor, backspace/delete remove, ←/→ home/end
 * move. A burst with a newline inserts what comes before it and submits, as a paste or scanner ending in
 * enter does; a lone enter submits. null for keys a text field doesn't take.
 */
export function editText(
  state: TextState,
  key: KeyPress,
): (TextState & { submit: boolean }) | null {
  const { value, cursor } = state;
  const at = (next: TextState, submit = false) => ({ ...next, submit });
  switch (key.name) {
    case "enter":
      return at(state, true);
    case "left":
      return at({ value, cursor: Math.max(0, cursor - 1) });
    case "right":
      return at({ value, cursor: Math.min(value.length, cursor + 1) });
    case "home":
      return at({ value, cursor: 0 });
    case "end":
      return at({ value, cursor: value.length });
    case "backspace":
      return cursor === 0
        ? at(state)
        : at({ value: value.slice(0, cursor - 1) + value.slice(cursor), cursor: cursor - 1 });
    case "delete":
      return at({ value: value.slice(0, cursor) + value.slice(cursor + 1), cursor });
    default:
      break;
  }
  const text = typed(key);
  if (!text) return null;
  return insertText(state, text);
}

/** Inserts text at the cursor; a newline in it ends the text there and submits. */
export function insertText(state: TextState, text: string): TextState & { submit: boolean } {
  const newline = text.search(/[\r\n]/);
  const line = newline < 0 ? text : text.slice(0, newline);
  return {
    value: state.value.slice(0, state.cursor) + line + state.value.slice(state.cursor),
    cursor: state.cursor + line.length,
    submit: newline >= 0,
  };
}
