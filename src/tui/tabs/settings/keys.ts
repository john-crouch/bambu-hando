// ABOUTME: Type-ahead over letters typed in quick succession, for the Settings tab's lists.
// ABOUTME: Joins letters within TYPE_AHEAD_MS into a prefix and leaves the matching to the design system's typeAhead.

import { typeAhead } from "../../ui/index.js";

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
  return { cursor: typeAhead(labels, cursor, text), typed: { text, at: now } };
}
