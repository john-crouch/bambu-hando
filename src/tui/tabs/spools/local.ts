// ABOUTME: Small helpers the Spools tab and the labels overlay share beside the design system's list and text helpers.
// ABOUTME: A text field's starting state and a paste as the typed burst it is.

import type { KeyPress } from "../../core/keys.js";
import type { TextState } from "../../ui/index.js";

/** A field holding value, its cursor at the end. */
export function textState(value: string): TextState {
  return { value, cursor: value.length };
}

/** A paste as a typed burst, never a named key: pasting "up" types "up". */
export function pasted(text: string): KeyPress {
  return { input: text, ctrl: false, shift: false, meta: false };
}
