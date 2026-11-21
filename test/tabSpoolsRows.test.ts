// ABOUTME: Tests for the Spools list's rows and summary: which columns fit a width, sized from what the rows hold.
// ABOUTME: The name keeps its room first; location and the date show only when some spool has one and there's room.

import { describe, expect, it } from "vitest";

import type { SpoolRecord } from "../src/spoolease.js";
import { inventoryRows } from "../src/spoolInventory.js";
import type { SpoolsSummary } from "../src/tui/tabs/spools/data.js";
import {
  addedText,
  spoolLayout,
  spoolListRows,
  summarySegments,
} from "../src/tui/tabs/spools/rows.js";
import { COLORS } from "../src/tui/ui/index.js";
import { segmentsWidth } from "../src/tui/ui/text.js";
import { FILAMENTS, spool } from "./tabSpoolsFixtures.js";

const NOW = Date.UTC(2026, 10, 21, 12);
const day = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 12) / 1000;

function rowsOf(spools: SpoolRecord[]) {
  return inventoryRows(spools, FILAMENTS, "", "newest");
}

const LONG = "Polymaker PLA PolyTerra™ Muted Green";
const placed = rowsOf([
  spool({ id: "1", slicerFilament: "", brand: LONG, material: "", colorName: "" }),
  spool({ id: "2", location: "AMS slot 1", addedTime: day(2026, 11, 16), currentWeight: 900 }),
]);

describe("spoolLayout", () => {
  it("leaves out location and added when no spool has one", () => {
    const rows = rowsOf([spool({ id: "1" }), spool({ id: "2" })]);
    expect(spoolLayout(rows, 140, NOW)).toMatchObject({ location: 0, added: 0 });
  });

  it("sizes location and added from what the rows hold", () => {
    expect(spoolLayout(placed, 140, NOW)).toMatchObject({ location: 10, added: 6 });
  });

  it("drops added, then location, before the name is cut short", () => {
    // 75 columns: the name keeps 32 columns only without the date.
    expect(spoolLayout(placed, 75, NOW)).toMatchObject({ location: 10, added: 0 });
    expect(spoolLayout(placed, 62, NOW)).toMatchObject({ location: 0, added: 0, bar: 10 });
  });

  it("shortens the bar on a narrow list so the name keeps more", () => {
    expect(spoolLayout(placed, 56, NOW)).toMatchObject({ location: 0, added: 0, bar: 5 });
  });

  it("sizes the ID column to the longest ID", () => {
    expect(spoolLayout(placed, 140, NOW).id).toBe(2);
    expect(spoolLayout(rowsOf([spool({ id: "123" })]), 140, NOW).id).toBe(4);
  });
});

describe("spoolListRows", () => {
  it("says empty, in red, for a spool with nothing left, and – for one not weighed", () => {
    const rows = rowsOf([
      spool({ id: "1", currentWeight: 200 }),
      spool({ id: "2", currentWeight: null }),
    ]);
    const [unweighed, empty] = spoolListRows(rows, [], 80, NOW);
    const left = (row: typeof empty) => row?.cells[2];
    expect(left(empty)).toMatchObject({ text: "empty", color: COLORS.failed });
    expect(empty?.cells[3]?.text.trim()).toBe("");
    expect(left(unweighed)).toMatchObject({ text: "–", dim: true });
  });
});

describe("addedText", () => {
  it("is the month and day this year, else the year and month", () => {
    expect(addedText(day(2026, 11, 16), NOW)).toBe("Nov 16");
    expect(addedText(day(2025, 3, 2), NOW)).toBe("2025-03");
    expect(addedText(null, NOW)).toBe("");
  });
});

describe("summarySegments", () => {
  const summary: SpoolsSummary = {
    count: 18,
    leftGrams: 6800,
    low: 4,
    empty: 1,
    unweighed: 3,
    sync: { state: "problems", problems: 7 },
  };
  const text = (width: number, s = summary) =>
    summarySegments(s, width)
      .map((seg) => seg.text)
      .join("");

  it("counts spools, what's left, low, empty and unweighed ones, and the sync problems with their key", () => {
    expect(text(200)).toBe(
      "18 spools · 6.8 kg left · 4 low · 1 empty · 3 not weighed · ! 7 problems, c to see",
    );
  });

  it("drops whole parts that don't fit, least useful first, never cutting one", () => {
    expect(text(56)).toBe("18 spools · 6.8 kg left · 4 low · ! 7 problems, c to see");
    expect(segmentsWidth(summarySegments(summary, 40))).toBeLessThanOrEqual(40);
    expect(text(40)).toBe("18 spools · ! 7 problems, c to see");
  });

  it("leaves out what's zero, and says 1 spool", () => {
    const one = { ...summary, count: 1, leftGrams: 564, low: 0, empty: 0, unweighed: 0 };
    expect(text(200, { ...one, sync: { state: "ok" } })).toBe("1 spool · 564 g left · ✓ in sync");
  });
});
