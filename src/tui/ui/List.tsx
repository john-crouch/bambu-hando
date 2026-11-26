// ABOUTME: A scrolling list: the cursor's row as a full-width selection bar, ticks, color chips, columns, filter matches.
// ABOUTME: Render-only: the tab keeps the cursor (moveCursor, typeAhead) and List shows the window around it.

import { Box } from "ink";
import { Line } from "./Line.js";
import {
  type Cell,
  cellWidths,
  type ListRow,
  listWindow,
  matchRanges,
  scrollThumb,
} from "./list.js";
import { swatchSegments } from "./Swatch.js";
import {
  fitSegments,
  padSegments,
  type Segment,
  segmentsWidth,
  spaces,
  textWidth,
} from "./text.js";
import { COLORS, ICONS, toneColor } from "./theme.js";

export type { Cell, ListRow } from "./list.js";
export {
  cellWidths,
  filterRows,
  listPosition,
  listWindow,
  matchRanges,
  moveCursor,
  scrollThumb,
  typeAhead,
} from "./list.js";

export interface ListProps {
  rows: readonly ListRow[];
  cursor: number;
  /** Rows to show; the list scrolls inside them. */
  height: number;
  width: number;
  /** "check" draws [✓]/[ ] before every row; "radio" ● on the chosen (ticked) row and ○ on the rest, for one-of choices. */
  marker?: "check" | "radio" | "none";
  /** Filter text: its words are highlighted wherever they appear in a cell. */
  highlight?: string;
  /** False when another panel has focus: the bar stays, quieter, so you still see where you were. */
  focused?: boolean;
}

/** Columns of the gutter mark and of a color chip, before the cells. */
const GUTTER = 1;
const CHIP = 2;

/** An unfocused list's bar: present but quiet. */
const IDLE_SELECTION = "#2A2633";

interface RowStyle {
  selected: boolean;
  background?: string;
}

/** A cell's text split at the filter's matches, matched parts in accent 2, cut and padded to w. */
function cellSegments(
  cell: Cell,
  w: number,
  base: Segment,
  highlight: string | undefined,
  style: RowStyle,
): Segment[] {
  if (w <= 0) return [];
  const ranges = highlight ? matchRanges(cell.text, highlight) : [];
  const parts: Segment[] = [];
  let at = 0;
  for (const [from, to] of ranges) {
    if (from > at) parts.push({ ...base, text: cell.text.slice(at, from) });
    parts.push({
      ...base,
      text: cell.text.slice(from, to),
      color: COLORS.accent2,
      bold: true,
      dim: false,
    });
    at = to;
  }
  if (at < cell.text.length) parts.push({ ...base, text: cell.text.slice(at) });
  const fill = style.background ? { backgroundColor: style.background } : {};
  if (cell.align !== "right") return padSegments(parts, w, fill);
  const cut = fitSegments(parts, w);
  const pad = w - segmentsWidth(cut);
  return pad > 0 ? [{ ...fill, text: spaces(pad) }, ...cut] : cut;
}

/** One row as segments of exactly width columns. */
export function rowSegments(
  row: ListRow,
  width: number,
  options: {
    selected: boolean;
    focused: boolean;
    marker: boolean;
    /** One-of choices: ● on the ticked row, ○ on the rest. */
    radio?: boolean;
    chip: boolean;
    highlight?: string;
    thumb: boolean;
    /** The list scrolls: a gap column keeps the cells off the thumb's column. */
    scrolls?: boolean;
  },
): Segment[] {
  const { selected, focused } = options;
  const background = selected ? (focused ? COLORS.selection : IDLE_SELECTION) : undefined;
  const bg = background ? { backgroundColor: background } : {};
  const style: RowStyle = { selected, ...(background ? { background } : {}) };
  const out: Segment[] = [];

  out.push(
    selected && focused
      ? { text: "▌", color: COLORS.accent, ...bg }
      : { text: spaces(GUTTER), ...bg },
  );
  if (options.marker) {
    out.push({ text: "[", color: COLORS.muted, ...bg });
    out.push(
      row.ticked
        ? { text: ICONS.ticked, color: COLORS.ok, bold: true, ...bg }
        : { text: " ", ...bg },
    );
    out.push({ text: "] ", color: COLORS.muted, ...bg });
  } else if (options.radio) {
    out.push(
      row.ticked
        ? { text: "●", color: COLORS.accent, bold: true, ...bg }
        : { text: "○", color: COLORS.muted, ...bg },
    );
    out.push({ text: " ", ...bg });
  }
  if (options.chip) {
    out.push(...(row.swatch ? swatchSegments(row.swatch, CHIP) : [{ text: spaces(CHIP), ...bg }]));
    out.push({ text: " ", ...bg });
  }

  const used = out.reduce((sum, segment) => sum + textWidth(segment.text), 0);
  // The last column is the scroll thumb's; a scrolling list keeps one more free before it.
  const cellsWidth = Math.max(0, width - used - (options.scrolls ? 2 : 1));
  const widths = cellWidths(row.cells, cellsWidth);
  let drawn = 0;
  row.cells.forEach((cell, index) => {
    const w = widths[index] ?? 0;
    if (w <= 0) return;
    if (drawn > 0) out.push({ text: " ", ...bg });
    const color =
      cell.color ??
      (row.tone ? toneColor(row.tone) : selected && focused ? COLORS.selectionText : undefined);
    const base: Segment = {
      text: "",
      ...bg,
      ...(color ? { color } : {}),
      // Dim cells stay dim on the bar; bold would cancel it in most terminals.
      ...(cell.dim || row.dim ? { dim: true } : selected && focused ? { bold: true } : {}),
    };
    out.push(...cellSegments(cell, w, base, options.highlight, style));
    drawn += w + (drawn > 0 ? 1 : 0);
  });
  const cellsUsed = out.reduce((sum, segment) => sum + textWidth(segment.text), 0) - used;
  if (cellsUsed < cellsWidth) out.push({ text: spaces(cellsWidth - cellsUsed), ...bg });
  if (options.scrolls) out.push({ text: " ", ...bg });
  out.push(options.thumb ? { text: "┃", color: COLORS.muted, ...bg } : { text: " ", ...bg });
  // Every piece is already its exact width; this only guards the total.
  return padSegments(out, width, bg);
}

export function List({
  rows,
  cursor,
  height,
  width,
  marker = "none",
  highlight,
  focused = true,
}: ListProps) {
  const { start, end } = listWindow(cursor, rows.length, height);
  const thumb = scrollThumb(start, height, rows.length);
  const chip = rows.some((row) => row.swatch);
  return (
    <Box flexDirection="column" flexShrink={0} width={Math.max(0, width)}>
      {rows.slice(start, end).map((row, offset) => {
        const index = start + offset;
        return (
          <Line
            key={row.key}
            width={width}
            segments={rowSegments(row, width, {
              selected: index === cursor,
              focused,
              marker: marker === "check",
              radio: marker === "radio",
              chip,
              ...(highlight ? { highlight } : {}),
              thumb: thumb !== null && offset >= thumb.from && offset < thumb.to,
              scrolls: thumb !== null,
            })}
          />
        );
      })}
    </Box>
  );
}
