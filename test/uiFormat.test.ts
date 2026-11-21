// ABOUTME: Tests for the shared value formatting (temperatures, ranges, grams, short printer names, plurals).
// ABOUTME: Every tab uses these, so one spelling shows everywhere.

import { describe, expect, it } from "vitest";

import {
  formatGrams,
  formatRange,
  formatTemp,
  plural,
  shortPrinter,
} from "../src/tui/ui/format.js";

describe("format", () => {
  it("writes temperatures and ranges without a space, with an en dash", () => {
    expect(formatTemp(220)).toBe("220°C");
    expect(formatRange(190, 230)).toBe("190–230°C");
    expect(formatRange(220, 220)).toBe("220°C");
    expect(formatRange(null, 230)).toBe("230°C");
    expect(formatRange(190, undefined)).toBe("190°C");
    expect(formatRange(null, null)).toBe("");
    expect(formatRange(Number.NaN, 230)).toBe("230°C");
  });

  it("writes whole grams", () => {
    expect(formatGrams(563.6)).toBe("564 g");
  });

  it("shortens BambuStudio's printer names", () => {
    expect(shortPrinter("Bambu Lab X1 Carbon 0.6 nozzle")).toBe("X1C 0.6");
    expect(shortPrinter("Bambu Lab P1S 0.4 nozzle")).toBe("P1S 0.4");
    expect(shortPrinter("My Printer")).toBe("My Printer");
  });

  it("counts in the singular for one", () => {
    expect(plural(1, "spool")).toBe("1 spool");
    expect(plural(3, "spool")).toBe("3 spools");
    expect(plural(2, "change")).toBe("2 changes");
    expect(plural(2, "match", "matches")).toBe("2 matches");
  });
});
