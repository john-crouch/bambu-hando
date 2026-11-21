// ABOUTME: A color chip: background-colored cells, the color a spool's filament is.
// ABOUTME: Near-black chips get thin gray edges, so a black filament still reads as a chip on a dark terminal.

import { Box } from "ink";

import { Line } from "./Line.js";
import type { Segment } from "./text.js";

/** Relative luminance of "#RRGGBB" (0 black … 1 white); undefined for anything else. */
export function luminance(color: string): number | undefined {
  const match = /^#?([0-9a-f]{6})$/i.exec(color);
  if (!match) return undefined;
  const value = Number.parseInt(match[1] ?? "", 16);
  const channel = (shift: number): number => {
    const c = ((value >> shift) & 0xff) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}

/** Below this a chip is too close to a dark terminal's background to see without edges. */
const DARK = 0.02;

const EDGE = "#6C6C6C";

/** One row of a chip `width` columns wide, as segments (List draws chips inside its rows with this). */
export function swatchSegments(color: string, width: number): Segment[] {
  if (width <= 0) return [];
  const dark = (luminance(color) ?? 1) < DARK;
  if (!dark || width < 2) return [{ text: " ".repeat(width), backgroundColor: color }];
  return [
    { text: "▕", color: EDGE, backgroundColor: color },
    ...(width > 2 ? [{ text: " ".repeat(width - 2), backgroundColor: color }] : []),
    { text: "▏", color: EDGE, backgroundColor: color },
  ];
}

export function Swatch({
  color,
  width,
  height = 1,
}: {
  color: string;
  width: number;
  height?: number;
}) {
  const row = swatchSegments(color, width);
  return (
    <Box flexDirection="column" flexShrink={0}>
      {Array.from({ length: Math.max(0, height) }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: identical rows of one chip.
        <Line key={index} segments={row} width={width} />
      ))}
    </Box>
  );
}
