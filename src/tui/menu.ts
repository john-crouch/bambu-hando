// ABOUTME: Shared list helpers for TUI menus: cursor moves with arrows and pages, and type-ahead by first letter.
// ABOUTME: Pure functions, so every menu moves the same way and is tested without rendering.

import type { Key } from "ink";

/** The cursor after an arrow or page key, kept within [0, count); null for keys that don't move. */
export function listMove(cursor: number, key: Key, count: number, page: number): number | null {
  const last = Math.max(0, count - 1);
  const clamp = (value: number): number => Math.max(0, Math.min(value, last));
  if (key.upArrow) return clamp(cursor - 1);
  if (key.downArrow) return clamp(cursor + 1);
  if (key.pageUp) return clamp(cursor - page);
  if (key.pageDown) return clamp(cursor + page);
  return null;
}

/** The next label after the cursor that starts with the typed letter (ignoring case), wrapping around; else the cursor. */
export function typeAhead(labels: string[], cursor: number, input: string): number {
  const letter = input.toLowerCase();
  for (let step = 1; step <= labels.length; step++) {
    const index = (cursor + step) % labels.length;
    if (labels[index]?.toLowerCase().startsWith(letter)) return index;
  }
  return cursor;
}

/** Letters typed closer together than this extend the same type-ahead prefix. */
export const TYPE_AHEAD_MS = 1_000;

export interface Typed {
  text: string;
  at: number;
}

/**
 * Type-ahead over several letters: letters typed in quick succession build a prefix ("su" finds Sunlu),
 * searched from the current item on; one letter repeated cycles through the items starting with it.
 */
export function typeAheadJump(
  labels: string[],
  cursor: number,
  letter: string,
  typed: Typed | undefined,
  now: number,
): { cursor: number; typed: Typed } {
  const recent = typed && now - typed.at <= TYPE_AHEAD_MS ? typed.text : "";
  const text = (recent + letter).toLowerCase();
  const next = { text, at: now };
  if ([...text].every((c) => c === text[0]))
    return { cursor: typeAhead(labels, cursor, letter), typed: next };
  for (let step = 0; step < labels.length; step++) {
    const index = (cursor + step) % labels.length;
    if (labels[index]?.toLowerCase().startsWith(text)) return { cursor: index, typed: next };
  }
  return { cursor, typed: next };
}

/** A single printable character typed without modifiers: what type-ahead reacts to. */
export function typedLetter(input: string, key: Key): string {
  if (key.ctrl || key.meta || input.length !== 1 || input === " ") return "";
  return input;
}
