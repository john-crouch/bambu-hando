// ABOUTME: Tests for the shared value formatting (temperatures, ranges, grams, short printer names, plurals).
// ABOUTME: Every tab uses these, so one spelling shows everywhere.

import { describe, expect, it } from "vitest";

import {
  fitPath,
  formatGrams,
  formatRange,
  formatTemp,
  plural,
  shortPrinter,
} from "../src/tui/ui/format.js";
import { textWidth } from "../src/tui/ui/text.js";

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

describe("fitPath", () => {
  const home = "/home/max";
  const preset = `${home}/.config/BambuStudio/user/1234/filament/base/Polymaker PETG PolyLite Black @X1C 0.4.json`;

  it("writes HOME as ~ and keeps a path that fits whole", () => {
    expect(fitPath(preset, 200, home)).toBe(
      "~/.config/BambuStudio/user/1234/filament/base/Polymaker PETG PolyLite Black @X1C 0.4.json",
    );
    expect(fitPath(home, 20, home)).toBe("~");
    expect(fitPath("/home/maxwell/a.json", 40, home)).toBe("/home/maxwell/a.json");
  });

  it("cuts folders out of the middle, keeping the start and as many folders before the file as fit", () => {
    expect(fitPath(preset, 61, home)).toBe(
      "~/…/filament/base/Polymaker PETG PolyLite Black @X1C 0.4.json",
    );
    expect(fitPath(preset, 52, home)).toBe("~/…/base/Polymaker PETG PolyLite Black @X1C 0.4.json");
    expect(fitPath(preset, 50, home)).toBe("~/…/Polymaker PETG PolyLite Black @X1C 0.4.json");
    expect(fitPath("/etc/bambu/presets/a.json", 17, home)).toBe("/…/presets/a.json");
    expect(fitPath("/etc/bambu/presets/a.json", 16, home)).toBe("/…/a.json");
  });

  it("cuts the file name in its middle last, so its start and end both show", () => {
    const cut = fitPath(preset, 30, home);
    expect(cut).toBe("~/…/Polymaker PET…X1C 0.4.json");
    expect(textWidth(cut)).toBeLessThanOrEqual(30);
    expect(fitPath("Polymaker PETG PolyLite Black.json", 12)).toBe("Polyma….json");
  });

  it("is never wider than its width", () => {
    for (let width = 0; width <= 100; width++)
      expect(textWidth(fitPath(preset, width, home))).toBeLessThanOrEqual(width);
  });
});
