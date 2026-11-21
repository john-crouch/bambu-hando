// ABOUTME: A gauge of narrow ▰/▱ cells: how much filament is left, how far a run has got.
// ABOUTME: Any amount above nothing shows a cell, and only a full one fills every cell.

import { Line } from "./Line.js";
import type { Segment } from "./text.js";
import { COLORS, type Tone, toneColor } from "./theme.js";

/** Filled cells out of width for a fraction (clamped to 0–1). */
export function barCells(fraction: number, width: number): number {
  if (width <= 0 || !(fraction > 0)) return 0;
  if (fraction >= 1) return width;
  return Math.min(width - 1, Math.max(1, Math.round(fraction * width)));
}

export function barSegments(fraction: number, width: number, tone: Tone = "accent"): Segment[] {
  const filled = barCells(fraction, width);
  return [
    { text: "▰".repeat(filled), color: toneColor(tone) },
    { text: "▱".repeat(Math.max(0, width - filled)), color: COLORS.muted },
  ];
}

export function Bar({ fraction, width, tone }: { fraction: number; width: number; tone?: Tone }) {
  return <Line segments={barSegments(fraction, width, tone)} width={width} />;
}
