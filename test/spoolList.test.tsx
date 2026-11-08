// ABOUTME: Tests for the TUI's spool inventory screen: typing filters, tab sorts, enter acts, esc clears then leaves.
// ABOUTME: The key handling is pure; the rendering is checked for what's left and the fill bar.

import type { Key } from "ink";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";

import type { SpoolRecord } from "../src/spoolease.js";
import { inventoryRows } from "../src/spoolInventory.js";
import { fillBar, initialSpoolList, SpoolList, spoolListInput } from "../src/tui/SpoolList.js";

function key(overrides: Partial<Key> = {}): Key {
  return overrides as Key;
}

function spool(overrides: Partial<SpoolRecord>): SpoolRecord {
  return {
    id: "1",
    tagId: "",
    material: "PLA",
    subtype: "",
    colorName: "Red",
    colorCodes: ["FF0000FF"],
    note: "",
    brand: "Acme",
    labelWeight: 1000,
    coreWeight: 200,
    fullWeight: null,
    currentWeight: null,
    consumedSinceWeighed: 0,
    slicerFilament: "",
    addedTime: null,
    location: "",
    ...overrides,
  };
}

describe("spoolListInput", () => {
  const start = initialSpoolList();

  it("filters as you type, back to the top, and backspace deletes", () => {
    const typed = spoolListInput({ ...start, cursor: 3 }, "pe", key(), 5, 10);
    expect(typed).toEqual({ type: "update", state: { ...start, filter: "pe", cursor: 0 } });
    expect(spoolListInput({ ...start, filter: "pe" }, "", key({ backspace: true }), 5, 10)).toMatchObject({ state: { filter: "p" } });
  });

  it("cycles the sort with tab", () => {
    expect(spoolListInput(start, "", key({ tab: true }), 5, 10)).toMatchObject({ state: { sort: "name" } });
    expect(spoolListInput({ ...start, sort: "location" }, "", key({ tab: true }), 5, 10)).toMatchObject({ state: { sort: "newest" } });
  });

  it("moves by line and page, and enter acts on the spool under the cursor", () => {
    expect(spoolListInput(start, "", key({ downArrow: true }), 5, 10)).toMatchObject({ state: { cursor: 1 } });
    expect(spoolListInput(start, "", key({ pageDown: true }), 30, 10)).toMatchObject({ state: { cursor: 10 } });
    expect(spoolListInput({ ...start, cursor: 2 }, "", key({ return: true }), 5, 10)).toEqual({ type: "choose", index: 2 });
    expect(spoolListInput(start, "", key({ return: true }), 0, 10)).toEqual({ type: "none" });
  });

  it("clears the filter with esc first, then goes back", () => {
    expect(spoolListInput({ ...start, filter: "pe" }, "", key({ escape: true }), 5, 10)).toMatchObject({ state: { filter: "" } });
    expect(spoolListInput(start, "", key({ escape: true }), 5, 10)).toEqual({ type: "back" });
  });
});

describe("fillBar", () => {
  it("fills a cell per tenth left, rounding, and is empty when unknown", () => {
    expect(fillBar(0.56)).toBe("██████░░░░");
    expect(fillBar(1)).toBe("██████████");
    expect(fillBar(0)).toBe("░░░░░░░░░░");
    expect(fillBar(null)).toBe("");
  });
});

describe("SpoolList", () => {
  it("shows each spool's id, name, what's left with a bar, location and date added", () => {
    const spools = [
      spool({ id: "1", currentWeight: 753, coreWeight: 189, location: "AMS 1", addedTime: Date.UTC(2026, 9, 31, 12) / 1000 }),
      spool({ id: "2", colorName: "Blue" }),
    ];
    const rows = inventoryRows(spools, new Map(), "", "newest");
    const { lastFrame } = render(<SpoolList rows={rows} total={2} state={initialSpoolList()} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Your spools on the console: 2 · newest first");
    expect(frame).toMatch(/#2 +Acme PLA Blue +–/);
    expect(frame).toMatch(/#1 +Acme PLA Red +564 g +██████░░░░ +AMS 1 +2026-10-31/);
    expect(frame).toContain("type to filter · tab sort · enter print or add more · esc menu · ? help");
  });

  it("says when the filter matches nothing, and that esc clears it", () => {
    const state = { ...initialSpoolList(), filter: "galaxy" };
    const { lastFrame } = render(<SpoolList rows={[]} total={2} state={state} />);
    expect(lastFrame()).toContain("Filter: galaxy");
    expect(lastFrame()).toContain("No spool matches every word");
    expect(lastFrame()).toContain("esc clear filter");
  });
});
