// ABOUTME: Unit tests for sizing TUI lists from the terminal's height.
// ABOUTME: The terminal's rows minus a screen's other lines, with a floor and a fallback when the height is unknown.

import { describe, expect, it } from "vitest";

import { listRows, MIN_LIST_ROWS } from "../src/tui/screenSize.js";

describe("listRows", () => {
  it("fills the terminal's height around the screen's other lines", () => {
    expect(listRows(40, 7, 16)).toBe(33);
    expect(listRows(24, 7, 16)).toBe(17);
  });

  it("never shows fewer than a few rows, even in a tiny terminal", () => {
    expect(listRows(8, 7, 16)).toBe(MIN_LIST_ROWS);
  });

  it("uses the screen's own default when the height is unknown (not a terminal)", () => {
    expect(listRows(undefined, 7, 16)).toBe(16);
    expect(listRows(0, 7, 16)).toBe(16);
  });
});
