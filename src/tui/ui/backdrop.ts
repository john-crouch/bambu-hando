// ABOUTME: Whether what's drawn is the backdrop behind an overlay: Segments and Panel then draw it gray and dim.
// ABOUTME: Frame provides it around the body while an overlay is open, so the dialog stands out whatever is under it.

import { createContext } from "react";

import type { Segment } from "./text.js";
import { COLORS } from "./theme.js";

export const Backdrop = createContext(false);

/** A segment as the backdrop draws it: same text, gray and dim, no background or emphasis. */
export function backdropSegment(segment: Segment): Segment {
  return { text: segment.text, color: COLORS.border, dim: true };
}
