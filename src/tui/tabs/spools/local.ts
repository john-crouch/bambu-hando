// ABOUTME: Small helpers the Spools tab and the labels overlay share beside the design system's list and text helpers.
// ABOUTME: A text field's starting state, a paste as the typed burst it is, and prose wrapped to a width.

import type { KeyPress } from "../../core/keys.js";
import { type TextState, textWidth, truncate } from "../../ui/index.js";

/** A field holding value, its cursor at the end. */
export function textState(value: string): TextState {
  return { value, cursor: value.length };
}

/** A paste as a typed burst, never a named key: pasting "up" types "up". */
export function pasted(text: string): KeyPress {
  return { input: text, ctrl: false, shift: false, meta: false };
}

/** Prose broken into lines of at most width columns at spaces; a word wider than a line is cut with …. */
export function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (textWidth(next) <= width) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = textWidth(word) <= width ? word : truncate(word, width);
  }
  if (line) lines.push(line);
  return lines;
}
