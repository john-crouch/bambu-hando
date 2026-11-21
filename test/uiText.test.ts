// ABOUTME: Tests the design system's text fitting: widths as Ink measures them, cuts that end in …, padding and segments.
// ABOUTME: Every component sizes its lines with these, so a line is never wider than the width it was given.

import { describe, expect, it } from "vitest";

import { fitText, fitSegments, segmentsWidth, textWidth, truncate } from "../src/tui/ui/text.js";

describe("textWidth", () => {
  it("counts columns as Ink does: one for the TUI's symbols, two for wide characters", () => {
    expect(textWidth("abc")).toBe(3);
    expect(textWidth("✓ ✗ ▰ ▱ ▸ ╭ ─ ° · …")).toBe(19);
    expect(textWidth("日本")).toBe(4);
    expect(textWidth("\u001B[31mred\u001B[39m")).toBe(3);
  });
});

describe("truncate", () => {
  it("leaves text that fits alone", () => {
    expect(truncate("Sunlu PETG", 10)).toBe("Sunlu PETG");
    expect(truncate("Sunlu PETG", 20)).toBe("Sunlu PETG");
  });

  it("cuts text that doesn't fit and ends it in …, exactly the width", () => {
    expect(truncate("Sunlu PETG Vivid Yellow", 10)).toBe("Sunlu PET…");
    expect(textWidth(truncate("Sunlu PETG Vivid Yellow", 10))).toBe(10);
  });

  it("never splits a wide character over the edge", () => {
    expect(truncate("日本語です", 6)).toBe("日本…");
    expect(textWidth(truncate("日本語です", 6))).toBe(5);
  });

  it("gives nothing for no room and only … for one column", () => {
    expect(truncate("abc", 0)).toBe("");
    expect(truncate("abc", -3)).toBe("");
    expect(truncate("abc", 1)).toBe("…");
  });

  it("drops a trailing space before the …, so a cut never reads as '… '", () => {
    expect(truncate("Sunlu PETG", 7)).toBe("Sunlu…");
  });
});

describe("fitText", () => {
  it("pads to the width on the right, or on the left when aligned right", () => {
    expect(fitText("564 g", 8)).toBe("564 g   ");
    expect(fitText("564 g", 8, "right")).toBe("   564 g");
  });

  it("cuts and pads in one go, so the result is always exactly the width", () => {
    for (const width of [0, 1, 5, 12, 40]) {
      expect(textWidth(fitText("OVERTURE PLA Basic White", width))).toBe(width);
      expect(textWidth(fitText("日本語の名前", width, "right"))).toBe(width);
    }
  });
});

describe("fitSegments", () => {
  const segments = [
    { text: "Sunlu ", bold: true },
    { text: "PETG", color: "red" },
    { text: " Yellow" },
  ];

  it("keeps segments that fit untouched", () => {
    expect(fitSegments(segments, 30)).toEqual(segments);
    expect(segmentsWidth(segments)).toBe(17);
  });

  it("cuts at the width, the … styled like the segment it ends", () => {
    const cut = fitSegments(segments, 9);
    expect(cut).toEqual([
      { text: "Sunlu ", bold: true },
      { text: "PE…", color: "red" },
    ]);
    expect(segmentsWidth(cut)).toBe(9);
  });

  it("drops segments past the cut and empty segments", () => {
    expect(fitSegments([{ text: "" }, { text: "abcdef" }, { text: "gh" }], 4)).toEqual([
      { text: "abc…" },
    ]);
    expect(fitSegments(segments, 0)).toEqual([]);
  });
});
