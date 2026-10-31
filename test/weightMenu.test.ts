// ABOUTME: Unit tests for the empty spool weight menu's items and key handling.
// ABOUTME: The menu is pure items + keys, so it is tested without rendering.

import type { Key } from "ink";
import { describe, expect, it } from "vitest";

import type { FilamentProfile } from "../src/models.js";
import { parseSpoolWeightList, weightGroups } from "../src/spoolWeights.js";
import { itemIndex, weightInput, weightItems } from "../src/tui/WeightMenu.js";

function key(overrides: Partial<Key> = {}): Key {
  return overrides as Key;
}

function profile(brand: string, coreWeight: number): FilamentProfile {
  return {
    name: `${brand} PLA`,
    brand,
    material: "PLA",
    colorName: "Black",
    colorRgba: "000000FF",
    nozzleTempMin: 200,
    nozzleTempMax: 220,
    density: 1.24,
    diameter: 1.75,
    slicerFilamentCode: "",
    filamentId: "P1",
    labelWeight: 1000,
    coreWeight,
  };
}

const entries = parseSpoolWeightList("Sunlu - V3 - 179g,179,Sunlu V3 with Cardboard - 219g,219\r\n");
const mine = parseSpoolWeightList("Sunlu weighed,171", true);

describe("weightItems", () => {
  it("lists a catalog brand's rows with their weights, marking the user's own", () => {
    const profiles = [profile("Sunlu", 189)];
    const [group] = weightGroups(profiles, [...entries, ...mine]);

    expect(weightItems(group!, profiles, "SpoolmanDB")).toEqual([
      { label: "Sunlu weighed", detail: "171 g · My Spools List", choice: { kind: "grams", grams: 171 } },
      { label: "Sunlu - V3 - 179g", detail: "179 g", choice: { kind: "grams", grams: 179 } },
      { label: "Sunlu V3 with Cardboard - 219g", detail: "219 g", choice: { kind: "grams", grams: 219 } },
    ]);
  });

  it("offers the source's weight first and unspecified for a brand the catalog doesn't list", () => {
    const profiles = [profile("Acme", 150)];
    const [group] = weightGroups(profiles, entries);

    expect(weightItems(group!, profiles, "SpoolmanDB")).toEqual([
      { label: "SpoolmanDB", detail: "150 g", choice: { kind: "source" } },
      { label: "Unspecified", detail: "SpoolEase works it out when the full spool is first weighed", choice: { kind: "unspecified" } },
    ]);
  });

  it("finds the item of an earlier choice, else the first", () => {
    const profiles = [profile("Sunlu", 189)];
    const items = weightItems(weightGroups(profiles, entries)[0]!, profiles, "SpoolmanDB");

    expect(itemIndex(items, { kind: "grams", grams: 219 })).toBe(1);
    expect(itemIndex(items, { kind: "grams", grams: 5 })).toBe(0);
    expect(itemIndex(items, undefined)).toBe(0);
  });
});

describe("weightInput", () => {
  it("moves within the items, chooses with enter, and goes back with escape", () => {
    expect(weightInput(0, key({ downArrow: true }), 3)).toEqual({ type: "move", cursor: 1 });
    expect(weightInput(2, key({ downArrow: true }), 3)).toEqual({ type: "move", cursor: 2 });
    expect(weightInput(0, key({ upArrow: true }), 3)).toEqual({ type: "move", cursor: 0 });
    expect(weightInput(1, key({ return: true }), 3)).toEqual({ type: "choose" });
    expect(weightInput(1, key({ escape: true }), 3)).toEqual({ type: "back" });
    expect(weightInput(1, key(), 3)).toEqual({ type: "none" });
  });
});
