// ABOUTME: Small pure helpers the Spools tab and the labels overlay use for lists and text fields.
// ABOUTME: Shaped like the design system's moveCursor/typeAhead/editText so they can be swapped for those.

import { type KeyPress, typed } from "../../core/keys.js";

/** The cursor after ↑↓ pgup pgdn home end in a list of `count` rows, `pageRows` on screen; null for other keys. */
export function moveCursor(
  cursor: number,
  key: KeyPress,
  count: number,
  pageRows: number,
): number | null {
  const last = Math.max(0, count - 1);
  const clamp = (n: number) => Math.max(0, Math.min(last, n));
  const page = Math.max(1, pageRows);
  switch (key.name) {
    case "up":
      return clamp(cursor - 1);
    case "down":
      return clamp(cursor + 1);
    case "pageUp":
      return clamp(cursor - page);
    case "pageDown":
      return clamp(cursor + page);
    case "home":
      return 0;
    case "end":
      return last;
    default:
      return null;
  }
}

/** The next label after the cursor (wrapping) starting with `char`, ignoring case; the cursor when none does. */
export function typeAhead(labels: readonly string[], cursor: number, char: string): number {
  const wanted = char.toLowerCase();
  for (let step = 1; step <= labels.length; step++) {
    const index = (cursor + step) % labels.length;
    if (labels[index]?.toLowerCase().startsWith(wanted)) return index;
  }
  return cursor;
}

/** A one-line text field's text and cursor position. */
export interface TextState {
  value: string;
  cursor: number;
}

export function textState(value: string): TextState {
  return { value, cursor: value.length };
}

/** The field after an editing key (text, space, backspace, delete, ←, →, home, end); null for any other key. */
export function editText(state: TextState, key: KeyPress): TextState | null {
  const { value, cursor } = state;
  if (key.ctrl || key.meta) return null;
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
    default:
      break;
  }
  const text = typed(key).replace(/[\r\n]/g, "");
  if (!text) return null;
  return {
    value: value.slice(0, cursor) + text + value.slice(cursor),
    cursor: cursor + text.length,
  };
}

/** A paste as a typed burst, never a named key: pasting "up" types "up". */
export function pasted(text: string): KeyPress {
  return { input: text, ctrl: false, shift: false, meta: false };
}
