// ABOUTME: The footer line: the tab's keys at the left, the global ones at the right end, primary ones kept when narrow.
// ABOUTME: Global keys drop from the left in one order, primary ones (? help) never; toasts draw above it (Frame).

import type { Hint } from "../core/types.js";
import { fitHints, HINT_GAP, hintSegments } from "./hints.js";
import { Line } from "./Line.js";
import { type Segment, segmentsWidth, spaces } from "./text.js";

/** Columns of space between the tab's keys and the global ones, at the least. */
const GROUP_GAP = HINT_GAP.length;

const width = (hints: readonly Hint[]): number => segmentsWidth(hintSegments(hints));

/**
 * The global hints that fit in width, in their order: the leftmost one that isn't primary goes first,
 * then the next, so they always drop in the same order whatever the width (never by what happens to fit).
 */
export function fitGlobal(global: readonly Hint[], width: number): Hint[] {
  const kept = [...global];
  while (width < (kept.length > 0 ? segmentsWidth(hintSegments(kept)) : 0)) {
    const at = kept.findIndex((hint) => !hint.primary);
    if (at < 0) return fitHints(kept, width);
    kept.splice(at, 1);
  }
  return kept;
}

/** The footer in exactly columns: hints at the left, global at the right end. */
export function footerSegments(
  hints: readonly Hint[],
  columns: number,
  global: readonly Hint[] = [],
): Segment[] {
  // One space margin each side.
  const inner = columns - 2;
  if (inner <= 0) return [];
  const gap = (left: readonly Hint[], right: readonly Hint[]) =>
    left.length > 0 && right.length > 0 ? GROUP_GAP : 0;
  const pinned = global.filter((hint) => hint.primary);
  const left = fitHints(hints, Math.max(0, inner - width(pinned) - gap(hints, pinned)));
  const right = fitGlobal(global, Math.max(0, inner - width(left) - gap(left, global)));
  const leftSegments = hintSegments(left);
  const rightSegments = hintSegments(right);
  const fill = inner - segmentsWidth(leftSegments) - segmentsWidth(rightSegments);
  return [{ text: " " }, ...leftSegments, { text: spaces(fill) }, ...rightSegments, { text: " " }];
}

export function Footer({
  hints,
  global,
  columns,
}: {
  hints: readonly Hint[];
  /** The keys that work everywhere, drawn at the right end. */
  global?: readonly Hint[];
  columns: number;
}) {
  return <Line segments={footerSegments(hints, columns, global)} width={columns} />;
}
