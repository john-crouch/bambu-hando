// ABOUTME: The Spools tab's list rows and summary line as design-system rows and segments, from the inventory.
// ABOUTME: Pure, so the columns that fit each width are tested without rendering.

import type { InventoryRow } from "../../../spoolInventory.js";
import { COLORS, type ListRow, type Segment, toneColor } from "../../ui/index.js";
import { addedDate, barTone, type SpoolsSummary, swatchOf } from "./data.js";

/** Cells of the bar showing what's left. */
export const BAR_CELLS = 10;

const ID_WIDTH = 5;
const LEFT_WIDTH = 6;
const LOCATION_WIDTH = 14;
const ADDED_WIDTH = 10;
/** List columns before the cells: the gutter, [✓] , the chip and its gap, and the scroll thumb after them. */
const ROW_CHROME = 1 + 4 + 3 + 1;
/** Names get at least this much before location and the date are shown. */
const NAME_WITH_LOCATION = 20;
const NAME_WITH_ADDED = 26;

/** ▰▰▰▱▱ for a fraction; spaces when unknown. */
export function barText(fraction: number | null, cells = BAR_CELLS): string {
  if (fraction === null) return " ".repeat(cells);
  const full =
    fraction <= 0
      ? 0
      : fraction >= 1
        ? cells
        : Math.min(cells - 1, Math.max(1, Math.round(fraction * cells)));
  return "▰".repeat(full) + "▱".repeat(cells - full);
}

/** Which optional columns a list `width` columns wide shows (the rest is in the detail panel). */
export function spoolColumns(width: number): { location: boolean; added: boolean } {
  const cells = width - ROW_CHROME;
  const base = ID_WIDTH + LEFT_WIDTH + BAR_CELLS + 3;
  const location = cells - base - LOCATION_WIDTH - 1 >= NAME_WITH_LOCATION;
  const added = location && cells - base - LOCATION_WIDTH - ADDED_WIDTH - 2 >= NAME_WITH_ADDED;
  return { location, added };
}

export function spoolListRows(
  rows: readonly InventoryRow[],
  ticked: readonly string[],
  width: number,
): ListRow[] {
  const columns = spoolColumns(width);
  return rows.map((row) => {
    const { spool } = row;
    const tone = barTone(row.fraction);
    const swatch = swatchOf(spool.colorCodes);
    return {
      key: spool.id,
      ticked: ticked.includes(spool.id),
      ...(swatch ? { swatch } : {}),
      cells: [
        { text: `#${spool.id}`, width: ID_WIDTH, dim: true },
        { text: row.name, grow: true },
        row.left === null
          ? { text: "–", width: LEFT_WIDTH, align: "right" as const, dim: true }
          : { text: `${row.left} g`, width: LEFT_WIDTH, align: "right" as const },
        {
          text: barText(row.fraction),
          width: BAR_CELLS,
          ...(tone ? { color: toneColor(tone) } : {}),
        },
        ...(columns.location ? [{ text: spool.location, width: LOCATION_WIDTH }] : []),
        ...(columns.added
          ? [{ text: addedDate(spool.addedTime), width: ADDED_WIDTH, dim: true }]
          : []),
      ],
    };
  });
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Grams as people read them: 640 g, 9.8 kg. */
export function weightText(grams: number): string {
  return grams < 1000 ? `${grams} g` : `${(grams / 1000).toFixed(1)} kg`;
}

/** "14 spools · 9.8 kg left · 3 low · ✓ in sync", each part in the color it means. */
export function summarySegments(summary: SpoolsSummary): Segment[] {
  const dot: Segment = { text: " · ", color: COLORS.muted };
  const out: Segment[] = [
    { text: plural(summary.count, "spool"), bold: true },
    dot,
    { text: `${weightText(summary.leftGrams)} left` },
  ];
  if (summary.low > 0) out.push(dot, { text: `${summary.low} low`, color: COLORS.warning });
  const { sync } = summary;
  switch (sync.state) {
    case "ok":
      out.push(dot, { text: "✓ in sync", color: COLORS.ok });
      break;
    case "problems":
      out.push(dot, {
        text: `! ${plural(sync.problems, "problem")}, see Check`,
        color: COLORS.warning,
      });
      break;
    case "checking":
      out.push(dot, { text: "checking sync…", color: COLORS.muted });
      break;
    case "failed":
      out.push(dot, { text: "✗ sync check failed", color: COLORS.failed });
      break;
    case "idle":
      break;
  }
  return out;
}
