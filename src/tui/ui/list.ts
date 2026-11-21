// ABOUTME: The pure list helpers tab updates call (scroll window, cursor moves, type-ahead, filtering) and List's row types.
// ABOUTME: Also the column and scroll-thumb arithmetic List draws with, kept here so it's tested without rendering.

import type { KeyPress } from "../core/keys.js";
import type { Align } from "./text.js";
import { textWidth } from "./text.js";
import type { Tone } from "./theme.js";

/** One column of a list row. */
export interface Cell {
  text: string;
  /** Fixed width; without it the cell takes its text's width (or the rest, when it grows). */
  width?: number;
  /** Takes the width the other cells leave; at most one cell per row grows. Cut with …. */
  grow?: boolean;
  align?: Align;
  color?: string;
  dim?: boolean;
}

export interface ListRow {
  key: string;
  cells: Cell[];
  /** Drawn as [✓] when the list has a check marker. */
  ticked?: boolean;
  /** "#RRGGBB": a color chip before the cells. */
  swatch?: string;
  dim?: boolean;
  /** Colors the row's cells that have no color of their own. */
  tone?: Tone;
}

/** A start-inclusive, end-exclusive span of string indices. */
export type Range = [number, number];

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(value, high));

/**
 * The rows to show, [start, end): the cursor stays in the middle once it's past the first half, and the
 * last page is full. Stateless, so the same cursor always shows the same rows.
 */
export function listWindow(
  cursor: number,
  count: number,
  height: number,
): { start: number; end: number } {
  if (count <= 0 || height <= 0) return { start: 0, end: 0 };
  if (count <= height) return { start: 0, end: count };
  const at = clamp(cursor, 0, count - 1);
  const start = clamp(at - Math.floor((height - 1) / 2), 0, count - height);
  return { start, end: start + height };
}

/** "3/14": where the cursor is, counted from one; empty for an empty list. */
export function listPosition(cursor: number, count: number): string {
  return count > 0 ? `${clamp(cursor, 0, count - 1) + 1}/${count}` : "";
}

/** The cursor after ↑ ↓ pgup pgdn home end, kept within the list without wrapping; null for other keys. */
export function moveCursor(
  cursor: number,
  key: KeyPress,
  count: number,
  pageRows: number,
): number | null {
  const last = Math.max(0, count - 1);
  const page = Math.max(1, pageRows);
  switch (key.name) {
    case "up":
      return clamp(cursor - 1, 0, last);
    case "down":
      return clamp(cursor + 1, 0, last);
    case "pageUp":
      return clamp(cursor - page, 0, last);
    case "pageDown":
      return clamp(cursor + page, 0, last);
    case "home":
      return 0;
    case "end":
      return last;
    default:
      return null;
  }
}

/**
 * Type-ahead: one letter (or the same letter repeated) jumps to the next label starting with it, wrapping
 * round; a longer prefix (the caller joins letters typed in quick succession) is searched from the cursor
 * on, so the cursor stays while it still matches. Ignores case; the cursor when nothing matches.
 */
export function typeAhead(labels: readonly string[], cursor: number, text: string): number {
  const prefix = text.toLowerCase();
  if (prefix === "" || labels.length === 0) return cursor;
  const repeated = [...prefix].every((c) => c === prefix[0]);
  const wanted = repeated ? (prefix[0] ?? "") : prefix;
  const from = repeated ? 1 : 0;
  for (let step = from; step < labels.length + from; step++) {
    const index = (cursor + step) % labels.length;
    if (labels[index]?.toLowerCase().startsWith(wanted)) return index;
  }
  return cursor;
}

function words(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

function merge(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: Range[] = [];
  for (const range of sorted) {
    const last = out.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else out.push([range[0], range[1]]);
  }
  return out;
}

/** Every occurrence of every word of the query in the text, ignoring case, merged and in order. */
export function matchRanges(text: string, query: string): Range[] {
  const lower = text.toLowerCase();
  const found: Range[] = [];
  for (const word of words(query)) {
    for (let at = lower.indexOf(word); at !== -1; at = lower.indexOf(word, at + 1)) {
      found.push([at, at + word.length]);
    }
  }
  return merge(found);
}

/**
 * The labels containing every word of the filter (any order, ignoring case), with the ranges to
 * highlight; every label, unmarked, for an empty filter.
 */
export function filterRows(
  labels: readonly string[],
  text: string,
): { index: number; ranges: Range[] }[] {
  const wanted = words(text);
  const out: { index: number; ranges: Range[] }[] = [];
  labels.forEach((label, index) => {
    const lower = label.toLowerCase();
    if (wanted.every((word) => lower.includes(word)))
      out.push({ index, ranges: matchRanges(label, text) });
  });
  return out;
}

/** The gap between cells. */
export const CELL_GAP = 1;

/**
 * Each cell's width in a row of `width` columns, gaps of CELL_GAP between the cells shown: fixed cells
 * get their width, others their text's, the grow cell the rest. When that doesn't fit, the grow cell goes
 * first, then cells are cut from the right. Never adds up past the width.
 */
export function cellWidths(cells: readonly Cell[], width: number): number[] {
  const natural = cells.map((cell) => (cell.grow ? 0 : (cell.width ?? textWidth(cell.text))));
  const growAt = cells.findIndex((cell) => cell.grow);
  const gaps = Math.max(0, cells.length - 1) * CELL_GAP;
  const fixed = natural.reduce((a, b) => a + b, 0);
  if (fixed + gaps <= width) {
    if (growAt >= 0) natural[growAt] = width - fixed - gaps;
    return natural;
  }
  // Too narrow: the grow cell (and its gap) goes, the rest fill from the left.
  let left = Math.max(0, width);
  let shown = 0;
  return natural.map((wanted, index) => {
    if (index === growAt || left <= 0) return 0;
    const gap = shown > 0 ? CELL_GAP : 0;
    const take = Math.max(0, Math.min(wanted, left - gap));
    if (take > 0) {
      left -= take + gap;
      shown++;
    }
    return take;
  });
}

/** Rows of the window [from, to) the scroll thumb covers; null when every row is shown. */
export function scrollThumb(
  start: number,
  height: number,
  count: number,
): { from: number; to: number } | null {
  if (height <= 0 || count <= height) return null;
  const size = clamp(Math.round((height * height) / count), 1, height);
  const room = height - size;
  const last = count - height;
  let from: number;
  if (start <= 0) from = 0;
  else if (start >= last) from = room;
  // Off the ends while the list can still scroll that way, so the thumb never claims you're at the end.
  else from = room >= 2 ? clamp(Math.round((start / last) * room), 1, room - 1) : 0;
  return { from, to: from + size };
}
