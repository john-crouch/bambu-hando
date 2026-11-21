// ABOUTME: Tests for the helpers the Spools tab and the labels overlay share: wrapping prose to a width.
// ABOUTME: Dialog sentences wrap at spaces and are never cut; only a single word wider than the line is.

import { describe, expect, it } from "vitest";

import { wrapText } from "../src/tui/tabs/spools/local.js";
import { textWidth } from "../src/tui/ui/index.js";

describe("wrapText", () => {
  it("wraps at spaces and keeps every word", () => {
    const text = "The console has 3 spools of this filament. Only spool records are added.";
    const lines = wrapText(text, 30);
    expect(lines).toEqual([
      "The console has 3 spools of",
      "this filament. Only spool",
      "records are added.",
    ]);
    for (const line of lines) expect(textWidth(line)).toBeLessThanOrEqual(30);
  });

  it("keeps a short text on one line, and an empty one as no lines", () => {
    expect(wrapText("Asked once.", 30)).toEqual(["Asked once."]);
    expect(wrapText("", 30)).toEqual([]);
  });

  it("cuts only a word that's wider than the line", () => {
    expect(wrapText("see http://192.168.100.200:8080/spools", 12)).toEqual(["see", "http://192.…"]);
  });
});
