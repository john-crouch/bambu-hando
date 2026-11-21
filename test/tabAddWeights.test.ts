// ABOUTME: Tests for the Add tab's empty spool weight choices: the items per brand, finding an earlier choice, source names.
// ABOUTME: Groups come from the real spoolWeights functions over SpoolEase-style weight lists.

import { describe, expect, it } from "vitest";

import { parseSpoolWeightList, weightGroups } from "../src/spoolWeights.js";
import { itemIndex, weightItems, weightSourceName } from "../src/tui/tabs/add/weights.js";
import { profile } from "./tabAddHarness.js";

const entries = parseSpoolWeightList(
  "Sunlu - V3 - 179g,179,Sunlu V3 with Cardboard - 219g,219\r\n",
);
const mine = parseSpoolWeightList("Sunlu weighed,171", true);

describe("weightItems", () => {
  it("lists the brand's rows, the user's own first, then the source's weight and unspecified", () => {
    const profiles = [profile({ brand: "Sunlu", coreWeight: 189 })];
    const [group] = weightGroups(profiles, [...entries, ...mine]);
    expect(weightItems(group!, profiles, "SpoolmanDB")).toEqual([
      {
        label: "Sunlu weighed",
        detail: "171 g · My Spools List",
        choice: { kind: "grams", grams: 171 },
      },
      { label: "Sunlu - V3 - 179g", detail: "179 g", choice: { kind: "grams", grams: 179 } },
      {
        label: "Sunlu V3 with Cardboard - 219g",
        detail: "219 g",
        choice: { kind: "grams", grams: 219 },
      },
      { label: "As listed in SpoolmanDB", detail: "189 g", choice: { kind: "source" } },
      {
        label: "Unspecified",
        detail: "SpoolEase works it out on the first full weigh",
        choice: { kind: "unspecified" },
      },
    ]);
  });

  it("offers the source's weight and unspecified for a brand no list has", () => {
    const profiles = [profile({ brand: "Acme", coreWeight: 150 })];
    const [group] = weightGroups(profiles, entries);
    expect(weightItems(group!, profiles, "mine.json").map((i) => [i.label, i.detail])).toEqual([
      ["As listed in mine.json", "150 g"],
      ["Unspecified", "SpoolEase works it out on the first full weigh"],
    ]);
  });
});

describe("itemIndex", () => {
  it("finds the item of an earlier choice, else the first", () => {
    const profiles = [profile({ brand: "Sunlu", coreWeight: 189 })];
    const items = weightItems(weightGroups(profiles, entries)[0]!, profiles, "SpoolmanDB");
    expect(itemIndex(items, { kind: "grams", grams: 219 })).toBe(1);
    expect(itemIndex(items, { kind: "unspecified" })).toBe(3);
    expect(itemIndex(items, { kind: "grams", grams: 5 })).toBe(0);
    expect(itemIndex(items, undefined)).toBe(0);
  });
});

describe("weightSourceName", () => {
  it("names where the brand's filaments come from", () => {
    expect(weightSourceName(["db", "db"], "mine.json")).toBe("SpoolmanDB");
    expect(weightSourceName(["import"], "mine.json")).toBe("mine.json");
    expect(weightSourceName(["db", "import"], "mine.json")).toBe("SpoolmanDB and mine.json");
  });
});
