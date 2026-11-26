// ABOUTME: Tests for the Add tab's word wrap: prose broken at spaces into lines of a width, long words cut.
// ABOUTME: Widths are measured as the terminal draws them (™, °, … count one column).

import { describe, expect, it } from "vitest";

import { wrapText } from "../src/tui/tabs/add/wrap.js";

describe("wrapText", () => {
  it("breaks at spaces, never wider than the width", () => {
    expect(wrapText("A new spool starts with its empty spool's weight", 20)).toEqual([
      "A new spool starts",
      "with its empty",
      "spool's weight",
    ]);
  });

  it("keeps short text on one line and drops empty text", () => {
    expect(wrapText("PolyLite™ Black", 20)).toEqual(["PolyLite™ Black"]);
    expect(wrapText("  ", 20)).toEqual([]);
  });

  it("cuts a word longer than the width", () => {
    expect(wrapText("~/.config/BambuStudio/user/1489686194 ok", 12)).toEqual([
      "~/.config/B…",
      "ok",
    ]);
  });

  it("stops at max lines, marking the cut", () => {
    expect(wrapText("one two three four five six", 9, 2)).toEqual(["one two", "three fo…"]);
  });
});
