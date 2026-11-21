// ABOUTME: Tests the list helpers tab updates call: scroll window, cursor moves, type-ahead, filtering with match ranges.
// ABOUTME: Also the column and scroll-thumb arithmetic List draws with; all pure, no rendering.

import { describe, expect, it } from "vitest";

import { press } from "../src/tui/core/keys.js";
import {
  cellWidths,
  filterRows,
  listPosition,
  listWindow,
  matchRanges,
  moveCursor,
  scrollThumb,
  typeAhead,
} from "../src/tui/ui/list.js";

describe("listWindow", () => {
  it("shows everything when the rows fit", () => {
    expect(listWindow(0, 5, 10)).toEqual({ start: 0, end: 5 });
    expect(listWindow(4, 5, 10)).toEqual({ start: 0, end: 5 });
  });

  it("keeps the cursor in the middle once it's past the first half", () => {
    expect(listWindow(0, 100, 10)).toEqual({ start: 0, end: 10 });
    expect(listWindow(4, 100, 10)).toEqual({ start: 0, end: 10 });
    expect(listWindow(5, 100, 10)).toEqual({ start: 1, end: 11 });
    expect(listWindow(50, 100, 10)).toEqual({ start: 46, end: 56 });
  });

  it("stops at the end, so the last page is full", () => {
    expect(listWindow(99, 100, 10)).toEqual({ start: 90, end: 100 });
    expect(listWindow(97, 100, 10)).toEqual({ start: 90, end: 100 });
  });

  it("always contains the cursor", () => {
    for (const height of [1, 2, 3, 7]) {
      for (let cursor = 0; cursor < 30; cursor++) {
        const { start, end } = listWindow(cursor, 30, height);
        expect(cursor).toBeGreaterThanOrEqual(start);
        expect(cursor).toBeLessThan(end);
        expect(end - start).toBe(height);
      }
    }
  });

  it("copes with no rows, no height and a cursor out of range", () => {
    expect(listWindow(0, 0, 10)).toEqual({ start: 0, end: 0 });
    expect(listWindow(3, 10, 0)).toEqual({ start: 0, end: 0 });
    expect(listWindow(42, 10, 4)).toEqual({ start: 6, end: 10 });
  });
});

describe("listPosition", () => {
  it("counts from one, and says nothing for an empty list", () => {
    expect(listPosition(2, 14)).toBe("3/14");
    expect(listPosition(0, 0)).toBe("");
  });
});

describe("moveCursor", () => {
  it("moves one row with the arrows, without wrapping", () => {
    expect(moveCursor(3, press("up"), 10, 5)).toBe(2);
    expect(moveCursor(3, press("down"), 10, 5)).toBe(4);
    expect(moveCursor(0, press("up"), 10, 5)).toBe(0);
    expect(moveCursor(9, press("down"), 10, 5)).toBe(9);
  });

  it("moves a page with pgup/pgdn and to the ends with home/end", () => {
    expect(moveCursor(3, press("pageDown"), 10, 5)).toBe(8);
    expect(moveCursor(8, press("pageDown"), 10, 5)).toBe(9);
    expect(moveCursor(3, press("pageUp"), 10, 5)).toBe(0);
    expect(moveCursor(4, press("home"), 10, 5)).toBe(0);
    expect(moveCursor(4, press("end"), 10, 5)).toBe(9);
  });

  it("pages at least one row", () => {
    expect(moveCursor(3, press("pageDown"), 10, 0)).toBe(4);
  });

  it("returns null for keys that don't move, so the caller handles them", () => {
    expect(moveCursor(3, press("enter"), 10, 5)).toBeNull();
    expect(moveCursor(3, press("a"), 10, 5)).toBeNull();
    expect(moveCursor(3, press("left"), 10, 5)).toBeNull();
  });

  it("stays at 0 in an empty list", () => {
    expect(moveCursor(0, press("down"), 0, 5)).toBe(0);
    expect(moveCursor(0, press("end"), 0, 5)).toBe(0);
  });
});

describe("typeAhead", () => {
  const labels = ["Overture", "Polymaker", "Sunlu", "Sunlu Matte", "eSun", "Elegoo"];

  it("jumps to the next label starting with the letter, ignoring case, wrapping round", () => {
    expect(typeAhead(labels, 0, "s")).toBe(2);
    expect(typeAhead(labels, 2, "s")).toBe(3);
    expect(typeAhead(labels, 3, "S")).toBe(2);
    expect(typeAhead(labels, 0, "e")).toBe(4);
    expect(typeAhead(labels, 4, "e")).toBe(5);
  });

  it("stays put when nothing starts with it", () => {
    expect(typeAhead(labels, 1, "z")).toBe(1);
    expect(typeAhead([], 0, "a")).toBe(0);
  });

  it("finds a longer prefix from the cursor on, so typing 'su' then 'sunlu m' narrows in place", () => {
    expect(typeAhead(labels, 2, "su")).toBe(2);
    expect(typeAhead(labels, 2, "sunlu m")).toBe(3);
    expect(typeAhead(labels, 0, "po")).toBe(1);
  });
});

describe("matchRanges", () => {
  it("marks every occurrence of every word, ignoring case", () => {
    expect(matchRanges("Sunlu PETG Sunlu", "sun")).toEqual([
      [0, 3],
      [11, 14],
    ]);
    expect(matchRanges("Sunlu PETG Vivid Yellow", "petg sun")).toEqual([
      [0, 3],
      [6, 10],
    ]);
  });

  it("merges overlapping and touching matches", () => {
    expect(matchRanges("PETG", "pe et")).toEqual([[0, 3]]);
    expect(matchRanges("PETG", "pe tg")).toEqual([[0, 4]]);
  });

  it("has nothing for an empty query or no match", () => {
    expect(matchRanges("PETG", "   ")).toEqual([]);
    expect(matchRanges("PETG", "abs")).toEqual([]);
  });
});

describe("filterRows", () => {
  const labels = ["Sunlu PETG Vivid Yellow", "OVERTURE PLA Basic White", "Sunlu PLA+ Black"];

  it("keeps every row, unmarked, for an empty filter", () => {
    expect(filterRows(labels, "")).toEqual([
      { index: 0, ranges: [] },
      { index: 1, ranges: [] },
      { index: 2, ranges: [] },
    ]);
  });

  it("keeps rows containing every word, in any order, with the ranges to highlight", () => {
    expect(filterRows(labels, "pla sunlu")).toEqual([
      {
        index: 2,
        ranges: [
          [0, 5],
          [6, 9],
        ],
      },
    ]);
    expect(filterRows(labels, "SUNLU").map((row) => row.index)).toEqual([0, 2]);
  });

  it("drops rows missing any word", () => {
    expect(filterRows(labels, "sunlu white")).toEqual([]);
  });
});

describe("cellWidths", () => {
  it("gives fixed cells their width, natural cells their text's, and the grow cell the rest", () => {
    const cells = [
      { text: "#14", width: 4 },
      { text: "Sunlu PETG", grow: true },
      { text: "564 g" },
    ];
    // 4 + 1 + grow + 1 + 5 = 30
    expect(cellWidths(cells, 30)).toEqual([4, 19, 5]);
  });

  it("shrinks the grow cell to nothing before cutting the cells after it", () => {
    const cells = [
      { text: "#14", width: 4 },
      { text: "Sunlu PETG", grow: true },
      { text: "564 g" },
    ];
    expect(cellWidths(cells, 11)).toEqual([4, 0, 5]);
    expect(cellWidths(cells, 8)).toEqual([4, 0, 3]);
    expect(cellWidths(cells, 3)).toEqual([3, 0, 0]);
  });

  it("never adds up past the width, gaps included", () => {
    const cells = [
      { text: "aaaa", width: 6 },
      { text: "bbbb", grow: true },
      { text: "cc", width: 3 },
    ];
    for (let width = 0; width < 20; width++) {
      const widths = cellWidths(cells, width);
      const shown = widths.filter((w) => w > 0);
      const used = shown.reduce((a, b) => a + b, 0) + Math.max(0, shown.length - 1);
      expect(used).toBeLessThanOrEqual(width);
    }
  });

  it("leaves natural widths alone when no cell grows", () => {
    expect(cellWidths([{ text: "ab" }, { text: "cd" }], 10)).toEqual([2, 2]);
  });
});

describe("scrollThumb", () => {
  it("has no thumb when everything fits", () => {
    expect(scrollThumb(0, 10, 5)).toBeNull();
  });

  it("sizes the thumb to the share shown and places it by the window's start", () => {
    expect(scrollThumb(0, 10, 100)).toEqual({ from: 0, to: 1 });
    expect(scrollThumb(90, 10, 100)).toEqual({ from: 9, to: 10 });
    expect(scrollThumb(0, 10, 20)).toEqual({ from: 0, to: 5 });
    expect(scrollThumb(10, 10, 20)).toEqual({ from: 5, to: 10 });
  });

  it("reaches the bottom only on the last page", () => {
    expect(scrollThumb(89, 10, 100)?.to).toBeLessThan(10);
    expect(scrollThumb(1, 10, 100)?.from).toBeGreaterThan(0);
  });
});
