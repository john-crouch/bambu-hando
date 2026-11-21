// ABOUTME: The footer line: the tab's keys at the left, the global ones at the right end, primary ones kept when narrow.
// ABOUTME: The tab's keys give way first; a global primary hint (? help) is never dropped. Toasts draw above it (Frame).

import type { Hint } from "../core/types.js";
import { fitHints, HINT_GAP, hintSegments } from "./hints.js";
import { Line } from "./Line.js";
import { type Segment, segmentsWidth, spaces } from "./text.js";

/** Columns of space between the tab's keys and the global ones, at the least. */
const GROUP_GAP = HINT_GAP.length;

const width = (hints: readonly Hint[]): number => segmentsWidth(hintSegments(hints));

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
  const right = fitHints(global, Math.max(0, inner - width(left) - gap(left, global)));
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
