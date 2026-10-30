// ABOUTME: Unit tests for the SpoolmanDB picker's key handling and list windowing.
// ABOUTME: The picker is pure state + keys, so it is tested without rendering.

import type { Key } from "ink";
import { describe, expect, it } from "vitest";

import type { FilamentProfile } from "../src/models.js";
import { initialPickerState, type PickerState, pickerInput, visibleRange } from "../src/tui/Picker.js";

function key(overrides: Partial<Key> = {}): Key {
  return overrides as Key;
}

function profile(filamentId: string): FilamentProfile {
  return {
    name: `Acme PLA ${filamentId}`,
    brand: "Acme",
    material: "PLA",
    colorName: filamentId,
    colorRgba: "808080FF",
    nozzleTempMin: 200,
    nozzleTempMax: 220,
    density: 1.24,
    diameter: 1.75,
    slicerFilamentCode: "",
    filamentId,
    labelWeight: 1000,
    coreWeight: 0,
  };
}

const matches = ["P1", "P2", "P3"].map(profile);

function update(state: PickerState, input: string, k: Partial<Key> = {}): PickerState {
  const action = pickerInput(state, input, key(k), matches);
  if (action.type !== "update") throw new Error(`expected an update, got ${action.type}`);
  return action.state;
}

describe("pickerInput", () => {
  const start = initialPickerState("pla");

  it("starts with the given query, nothing selected", () => {
    expect(start).toEqual({ query: "pla", cursor: 0, selected: new Set(), error: "" });
  });

  it("types into the query and moves the cursor back to the top", () => {
    const moved = { ...start, cursor: 2 };
    expect(update(moved, " r")).toMatchObject({ query: "pla r", cursor: 0 });
  });

  it("deletes the last query character with backspace or delete", () => {
    expect(update(start, "", { backspace: true }).query).toBe("pl");
    expect(update(start, "", { delete: true }).query).toBe("pl");
  });

  it("ignores other control keys", () => {
    expect(update(start, "x", { ctrl: true })).toEqual(start);
    expect(update(start, "x", { meta: true })).toEqual(start);
  });

  it("moves the cursor within the matches", () => {
    expect(update(start, "", { upArrow: true }).cursor).toBe(0);
    expect(update(start, "", { downArrow: true }).cursor).toBe(1);
    expect(update({ ...start, cursor: 2 }, "", { downArrow: true }).cursor).toBe(2);
    expect(update(start, "", { pageDown: true }).cursor).toBe(2);
    expect(update({ ...start, cursor: 2 }, "", { pageUp: true }).cursor).toBe(0);
  });

  it("toggles the highlighted filament with tab and moves down", () => {
    const once = update(start, "", { tab: true });
    expect(once).toMatchObject({ cursor: 1, selected: new Set(["P1"]) });

    const back = update({ ...once, cursor: 0 }, "", { tab: true });
    expect(back.selected).toEqual(new Set());
  });

  it("selects every match with ctrl+a, and clears them when all are selected", () => {
    const all = update({ ...start, selected: new Set(["P2", "OTHER"]) }, "a", { ctrl: true });
    expect(all.selected).toEqual(new Set(["P1", "P2", "P3", "OTHER"]));

    expect(update(all, "a", { ctrl: true }).selected).toEqual(new Set(["OTHER"]));
  });

  it("asks for a selection before continuing", () => {
    expect(update(start, "", { return: true }).error).toBe("Select filaments with tab (ctrl+a selects every match)");
  });

  it("continues with a selection, even when it is filtered out of view", () => {
    expect(pickerInput({ ...start, selected: new Set(["OTHER"]) }, "", key({ return: true }), matches)).toEqual({ type: "done" });
  });

  it("goes back with escape", () => {
    expect(pickerInput(start, "", key({ escape: true }), matches)).toEqual({ type: "back" });
  });

  it("clears the error on the next key", () => {
    expect(update({ ...start, error: "oops" }, "", { downArrow: true }).error).toBe("");
  });
});

describe("visibleRange", () => {
  it("shows everything when it fits", () => {
    expect(visibleRange(0, 5, 12)).toEqual([0, 5]);
  });

  it("keeps the cursor in view, centered when possible", () => {
    expect(visibleRange(0, 100, 12)).toEqual([0, 12]);
    expect(visibleRange(50, 100, 12)).toEqual([44, 56]);
    expect(visibleRange(99, 100, 12)).toEqual([88, 100]);
  });
});
