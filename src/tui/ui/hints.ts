// ABOUTME: Key hints as line segments, `key` in accent 2 and its meaning dim, and which hints fit a width.
// ABOUTME: Shared by the footer and dialogs, so keys read the same everywhere.

import type { Hint } from "../core/types.js";
import { type Segment, segmentsWidth } from "./text.js";
import { COLORS } from "./theme.js";

export const HINT_GAP = "  ";

export function hintSegments(hints: readonly Hint[]): Segment[] {
  return hints.flatMap((hint, index) => [
    ...(index > 0 ? [{ text: HINT_GAP }] : []),
    { text: hint.keys, color: COLORS.accent2, bold: true },
    { text: ` ${hint.label}`, color: COLORS.muted },
  ]);
}

/**
 * The hints that fit in width columns, in their own order: all of them when they fit; else the primary
 * ones first (as many as fit), then the others while there's room.
 */
export function fitHints(hints: readonly Hint[], width: number): Hint[] {
  if (segmentsWidth(hintSegments(hints)) <= width) return [...hints];
  const chosen = new Set<Hint>();
  const fits = (candidate: Hint): boolean =>
    segmentsWidth(hintSegments(hints.filter((hint) => chosen.has(hint) || hint === candidate))) <=
    width;
  for (const hint of hints) if (hint.primary && fits(hint)) chosen.add(hint);
  for (const hint of hints) if (!hint.primary && fits(hint)) chosen.add(hint);
  return hints.filter((hint) => chosen.has(hint));
}
