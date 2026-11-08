// ABOUTME: Unit tests for the sync check screen: the report as lines, and scrolling through them.
// ABOUTME: Pure functions, so they are tested without rendering.

import type { Key } from "ink";
import { describe, expect, it } from "vitest";

import type { CheckSection } from "../src/syncCheck.js";
import { checkInput, checkLines, checkSummary } from "../src/tui/SyncCheck.js";

function key(overrides: Partial<Key> = {}): Key {
  return overrides as Key;
}

const SECTIONS: CheckSection[] = [
  { key: "csvOnly", title: "Filaments without a preset", why: "Fix them.", problem: true, items: ["A (P1)", "B (P2)"] },
  { key: "badRows", title: "Bad rows", why: "Commas.", problem: true, items: [] },
  { key: "presetsOnly", title: "Presets only", why: "Fine.", problem: false, items: ["C (P3) · X1C"] },
];

describe("checkLines", () => {
  it("lists each section with its count, why, and items, and an empty one as a single ok line", () => {
    expect(checkLines(SECTIONS)).toEqual([
      { tone: "problem", text: "✗ Filaments without a preset: 2" },
      { tone: "why", text: "  Fix them." },
      { tone: "item", text: "    A (P1)" },
      { tone: "item", text: "    B (P2)" },
      { tone: "ok", text: "✓ Bad rows: none" },
      { tone: "note", text: "! Presets only: 1" },
      { tone: "why", text: "  Fine." },
      { tone: "item", text: "    C (P3) · X1C" },
    ]);
  });
});

describe("checkSummary", () => {
  it("counts problems and notes, or says everything lines up", () => {
    expect(checkSummary(SECTIONS)).toBe("2 problems, 1 note");
    expect(checkSummary(SECTIONS.map((s) => ({ ...s, items: [] })))).toBe("Everything lines up");
  });
});

describe("checkInput", () => {
  it("scrolls by line and page, never past the last screenful", () => {
    expect(checkInput(0, "", key({ downArrow: true }), 50, 20)).toEqual({ type: "scroll", top: 1 });
    expect(checkInput(0, "", key({ upArrow: true }), 50, 20)).toEqual({ type: "scroll", top: 0 });
    expect(checkInput(0, "", key({ pageDown: true }), 50, 20)).toEqual({ type: "scroll", top: 20 });
    expect(checkInput(25, "", key({ pageDown: true }), 50, 20)).toEqual({ type: "scroll", top: 30 });
    expect(checkInput(0, "", key({ downArrow: true }), 10, 20)).toEqual({ type: "scroll", top: 0 });
  });

  it("goes back with escape or b, checks again with r, and quits with q", () => {
    expect(checkInput(0, "", key({ escape: true }), 5, 20)).toEqual({ type: "back" });
    expect(checkInput(0, "b", key(), 5, 20)).toEqual({ type: "back" });
    expect(checkInput(0, "r", key(), 5, 20)).toEqual({ type: "again" });
    expect(checkInput(0, "q", key(), 5, 20)).toEqual({ type: "quit" });
    expect(checkInput(0, "x", key(), 5, 20)).toEqual({ type: "none" });
  });
});
