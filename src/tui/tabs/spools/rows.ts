// ABOUTME: The Spools tab's list rows and summary line as design-system rows and segments, from the inventory.
// ABOUTME: Pure, so the columns that fit each width are tested without rendering: the name keeps its room first.

import type { InventoryRow } from "../../../spoolInventory.js";
import {
  COLORS,
  formatGrams,
  type ListRow,
  plural,
  type Segment,
  textWidth,
  toneColor,
} from "../../ui/index.js";
import { segmentsWidth } from "../../ui/text.js";
import { addedText, barTone, type SpoolsSummary, swatchOf } from "./data.js";

/** Cells of the bar showing what's left; SHORT_BAR on a list too narrow to keep the name whole. */
export const BAR_CELLS = 10;
const SHORT_BAR = 5;

/** The left column holds "920 g", "empty" or "–": at least this wide. */
const LEFT_MIN = 5;
const LOCATION_MAX = 14;
/**
 * List columns before and after the cells: the gutter, [✓] , the chip and its gap, then a gap and the
 * scroll thumb.
 */
const ROW_CHROME = 1 + 4 + 3 + 2;
/** The name keeps this many columns (or its whole length, when shorter) before an optional column shows. */
const NAME_KEEP = 32;

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

/** The added date's one format, shared with the detail. */
export { addedText } from "./data.js";

function leftText(row: InventoryRow): string {
  if (row.left === null) return "–";
  if (row.left === 0) return "empty";
  return formatGrams(row.left);
}

/** Column widths for these rows in a list `width` wide; 0 is a column left out (the detail has it). */
export interface SpoolLayout {
  id: number;
  left: number;
  bar: number;
  location: number;
  added: number;
}

const widest = (texts: string[]): number => texts.reduce((w, t) => Math.max(w, textWidth(t)), 0);

/**
 * The columns that fit: a column no row has a value for is left out; the date shows only when every
 * name fits whole, the location when the names keep NAME_KEEP columns (or their whole length); on a
 * narrow list the bar shortens too.
 */
export function spoolLayout(
  rows: readonly InventoryRow[],
  width: number,
  now: number,
): SpoolLayout {
  const cells = width - ROW_CHROME;
  const id = widest(rows.map((r) => `#${r.spool.id}`));
  const left = Math.max(LEFT_MIN, widest(rows.map(leftText)));
  const location = Math.min(LOCATION_MAX, widest(rows.map((r) => r.spool.location)));
  const added = widest(rows.map((r) => addedText(r.spool.addedTime, now)));
  const longest = widest(rows.map((r) => r.name));
  const want = Math.min(NAME_KEEP, longest);
  // Every shown cell after the name costs its width and a one-column gap.
  const nameRoom = (bar: number, ...extra: number[]) =>
    cells - id - left - bar - 3 - extra.reduce((sum, w) => sum + (w > 0 ? w + 1 : 0), 0);
  if (nameRoom(BAR_CELLS, location, added) >= longest)
    return { id, left, bar: BAR_CELLS, location, added };
  if (nameRoom(BAR_CELLS, location) >= want)
    return { id, left, bar: BAR_CELLS, location, added: 0 };
  const bar = nameRoom(BAR_CELLS) >= want ? BAR_CELLS : SHORT_BAR;
  return { id, left, bar, location: 0, added: 0 };
}

export function spoolListRows(
  rows: readonly InventoryRow[],
  ticked: readonly string[],
  width: number,
  now: number,
): ListRow[] {
  const layout = spoolLayout(rows, width, now);
  return rows.map((row) => {
    const { spool } = row;
    const tone = barTone(row.fraction);
    const swatch = swatchOf(spool.colorCodes);
    const empty = row.left === 0;
    return {
      key: spool.id,
      ticked: ticked.includes(spool.id),
      ...(swatch ? { swatch } : {}),
      cells: [
        { text: `#${spool.id}`, width: layout.id, dim: true },
        { text: row.name, grow: true },
        {
          text: leftText(row),
          width: layout.left,
          align: "right" as const,
          ...(row.left === null ? { dim: true } : {}),
          ...(empty ? { color: COLORS.failed } : {}),
        },
        {
          text: empty ? "" : barText(row.fraction, layout.bar),
          width: layout.bar,
          ...(tone ? { color: toneColor(tone) } : {}),
        },
        ...(layout.location ? [{ text: spool.location, width: layout.location }] : []),
        ...(layout.added
          ? [{ text: addedText(spool.addedTime, now), width: layout.added, dim: true }]
          : []),
      ],
    };
  });
}

/** Grams as people read them: 640 g, 9.8 kg. */
export function weightText(grams: number): string {
  return grams < 1000 ? formatGrams(grams) : `${(grams / 1000).toFixed(1)} kg`;
}

/** The summary's parts, most useful first: what to drop last when the line is short. */
function summaryParts(summary: SpoolsSummary): { order: number; segments: Segment[] }[] {
  const part = (order: number, segment: Segment) => ({ order, segments: [segment] });
  const parts = [part(0, { text: plural(summary.count, "spool"), bold: true })];
  const { sync } = summary;
  const syncSegments: Segment[] | null =
    sync.state === "ok"
      ? [{ text: "✓ in sync", color: COLORS.ok }]
      : sync.state === "problems"
        ? [
            { text: `! ${plural(sync.problems, "problem")} (`, color: COLORS.warning },
            // The key that opens Check, drawn as the footer draws keys.
            { text: "c", color: COLORS.accent2, bold: true },
            { text: ")", color: COLORS.warning },
          ]
        : sync.state === "checking"
          ? [{ text: "checking sync…", color: COLORS.muted }]
          : sync.state === "failed"
            ? [{ text: "✗ sync check failed", color: COLORS.failed }]
            : null;
  if (syncSegments) parts.push({ order: 5, segments: syncSegments });
  parts.push(part(1, { text: `${weightText(summary.leftGrams)} left` }));
  if (summary.low > 0) parts.push(part(2, { text: `${summary.low} low`, color: COLORS.warning }));
  if (summary.empty > 0)
    parts.push(part(3, { text: `${summary.empty} empty`, color: COLORS.failed }));
  if (summary.unweighed > 0)
    parts.push(part(4, { text: `${summary.unweighed} unweighed`, color: COLORS.muted }));
  return parts;
}

/**
 * "18 spools · 6.8 kg left · 4 low · 1 empty · 3 unweighed · ✓ in sync", each part in the color it
 * means. Parts that don't fit `width` are left out whole, the least useful first; none is cut.
 */
export function summarySegments(
  summary: SpoolsSummary,
  width = Number.POSITIVE_INFINITY,
): Segment[] {
  const parts = summaryParts(summary);
  const dot: Segment = { text: " · ", color: COLORS.muted };
  const line = (kept: typeof parts) =>
    [...kept]
      .sort((a, b) => a.order - b.order)
      .flatMap((part, index) => (index > 0 ? [dot, ...part.segments] : part.segments));
  let kept = parts;
  while (kept.length > 1 && segmentsWidth(line(kept)) > width) kept = kept.slice(0, -1);
  return line(kept);
}
