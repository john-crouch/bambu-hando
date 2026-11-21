// ABOUTME: Label/value lines for a detail panel: labels dim in one aligned column, values in their tone's color.
// ABOUTME: A row with an empty label and value is a blank spacer line; long values end in ….

import { Box } from "ink";

import { Line } from "./Line.js";
import { type Segment, spaces, textWidth, truncate } from "./text.js";
import { COLORS, type Tone, toneColor } from "./theme.js";

export interface DetailRow {
  label: string;
  value: string;
  tone?: Tone;
  dim?: boolean;
}

/** Margin left of the labels and between labels and values. */
const MARGIN = 1;
const GAP = 2;

export function detailSegments(row: DetailRow, width: number, labelWidth: number): Segment[] {
  if (row.label === "" && row.value === "") return [];
  const labelRoom = Math.min(labelWidth, Math.max(0, width - MARGIN - 1));
  const label = truncate(row.label, labelRoom);
  const valueRoom = width - MARGIN - labelRoom - GAP - MARGIN;
  const value = truncate(row.value, valueRoom);
  return [
    { text: spaces(MARGIN) },
    { text: label, color: COLORS.muted },
    { text: spaces(labelRoom - textWidth(label) + (valueRoom > 0 ? GAP : 0)) },
    {
      text: value,
      ...(row.tone ? { color: toneColor(row.tone) } : {}),
      ...(row.dim ? { dim: true } : {}),
    },
  ];
}

/** The widest label: the default label column. */
export function labelColumn(rows: readonly DetailRow[]): number {
  return rows.reduce((widest, row) => Math.max(widest, textWidth(row.label)), 0);
}

export function Detail({
  rows,
  width,
  labelWidth,
}: {
  rows: readonly DetailRow[];
  width: number;
  labelWidth?: number;
}) {
  const column = labelWidth ?? labelColumn(rows);
  return (
    <Box flexDirection="column" flexShrink={0} width={Math.max(0, width)}>
      {rows.map((row, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional; labels may repeat or be empty.
        <Line key={index} segments={detailSegments(row, width, column)} width={width} />
      ))}
    </Box>
  );
}
