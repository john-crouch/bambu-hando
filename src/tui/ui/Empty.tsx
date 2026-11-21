// ABOUTME: An empty state, centered in its area: what's missing, why, and the key that fixes it.
// ABOUTME: Lines are centered to whole columns and cut with …, so it fits any panel.

import { Box } from "ink";

import type { Hint } from "../core/types.js";
import { Line } from "./Line.js";
import { type Segment, segmentsWidth, spaces, truncate } from "./text.js";
import { COLORS } from "./theme.js";

/** The segments centered in width columns (cut to fit first). */
export function centered(segments: Segment[], width: number): Segment[] {
  const total = segmentsWidth(segments);
  if (total >= width) {
    const text = segments.map((segment) => segment.text).join("");
    return [{ ...segments[0], text: truncate(text, width) }];
  }
  return [{ text: spaces(Math.floor((width - total) / 2)) }, ...segments];
}

export interface EmptyProps {
  title: string;
  lines?: readonly string[];
  action?: Hint;
  width: number;
  height: number;
}

export function emptyLines({
  title,
  lines = [],
  action,
}: Omit<EmptyProps, "width" | "height">): Segment[][] {
  const out: Segment[][] = [[{ text: title, bold: true }]];
  if (lines.length > 0) out.push([]);
  for (const line of lines) out.push([{ text: line, color: COLORS.muted }]);
  if (action) {
    out.push([]);
    out.push([
      { text: action.keys, color: COLORS.accent2, bold: true },
      { text: ` ${action.label}`, color: COLORS.muted },
    ]);
  }
  return out;
}

export function Empty({ width, height, ...content }: EmptyProps) {
  const lines = emptyLines(content).slice(0, Math.max(0, height));
  const top = Math.max(0, Math.floor((height - lines.length) / 2));
  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      width={Math.max(0, width)}
      height={Math.max(0, height)}
    >
      {Array.from({ length: top }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: blank spacer lines.
        <Line key={`top${index}`} segments={[]} width={width} />
      ))}
      {lines.map((line, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional lines.
        <Line key={index} segments={line.length > 0 ? centered(line, width) : []} width={width} />
      ))}
    </Box>
  );
}
