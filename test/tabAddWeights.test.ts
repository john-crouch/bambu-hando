// ABOUTME: Tests for the Add tab's empty spool weight choices: the items per brand, finding an earlier choice, source names.
// ABOUTME: Groups come from the real spoolWeights functions over SpoolEase-style weight lists.

import { describe, expect, it } from "vitest";

import { parseSpoolWeightList, weightGroups } from "../src/spoolWeights.js";
import { press } from "../src/tui/core/keys.js";
import { addTab } from "../src/tui/tabs/add/index.js";
import { itemIndex, weightItems, weightSourceName } from "../src/tui/tabs/add/weights.js";
import { ctx, profile } from "./tabAddHarness.js";

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
        weight: "171 g",
        detail: "From your My Spools List on SpoolEase.",
        origin: "your list",
        choice: { kind: "grams", grams: 171 },
      },
      {
        label: "Sunlu - V3",
        weight: "179 g",
        detail: "From SpoolEase's spool catalog: Sunlu - V3 - 179g.",
        origin: "catalog",
        choice: { kind: "grams", grams: 179 },
      },
      {
        label: "Sunlu V3 with Cardboard",
        weight: "219 g",
        detail: "From SpoolEase's spool catalog: Sunlu V3 with Cardboard - 219g.",
        origin: "catalog",
        choice: { kind: "grams", grams: 219 },
      },
      {
        label: "As listed in SpoolmanDB",
        weight: "189 g",
        detail: "The empty spool weight SpoolmanDB gives for these filaments.",
        origin: "",
        choice: { kind: "source" },
      },
      {
        label: "Unspecified",
        weight: "–",
        detail: "SpoolEase works it out on the first full weigh.",
        origin: "",
        choice: { kind: "unspecified" },
      },
    ]);
  });

  it("offers the source's weight and unspecified for a brand no list has", () => {
    const profiles = [profile({ brand: "Acme", coreWeight: 150 })];
    const [group] = weightGroups(profiles, entries);
    expect(weightItems(group!, profiles, "mine.json").map((i) => [i.label, i.weight])).toEqual([
      ["As listed in mine.json", "150 g"],
      ["Unspecified", "–"],
    ]);
  });

  it("says when the catalog has rows of the same name, and how to tell them apart", () => {
    const profiles = [profile({ brand: "Sunlu", coreWeight: 189 })];
    const same = parseSpoolWeightList("Sunlu - Plastic - 117g,117,Sunlu - Plastic - 150g,150");
    const items = weightItems(weightGroups(profiles, same)[0]!, profiles, "SpoolmanDB");
    expect(items[0]?.detail).toBe(
      "From SpoolEase's spool catalog: Sunlu - Plastic - 117g. It has more than one Sunlu - Plastic (117 g, 150 g): weigh an empty spool to tell which is yours.",
    );
  });
});

describe("the Weights page's keys", () => {
  const c = ctx({ values: { skipSpoolease: false, host: "10.0.0.5", securityKey: "K" } });
  function weightsPage() {
    let [model] = addTab.init(c, { query: "" });
    for (const key of ["enter", "down", "enter", "down", "space", "right"])
      [model] = addTab.update(model, { type: "key", key: press(key) }, c);
    return addTab.update(
      model,
      {
        type: "add/weightsRead",
        signature: model.weights.signature,
        entries: parseSpoolWeightList("Acme - Plastic - 180g,180,Acme - Cardboard - 140g,140"),
        warnings: [],
        spooled: [],
        remembered: {},
      },
      c,
    )[0];
  }

  it("→ takes the marked choice and goes on, like enter on it", () => {
    const model = weightsPage();
    expect(model.page).toBe("weights");
    const [next] = addTab.update(model, { type: "key", key: press("right") }, c);
    expect(next.page).toBe("review");
    expect(next.weightChoices.get("acme")).toEqual({ kind: "source" });
  });

  it("→ after moving the cursor still takes the marked choice, not the highlighted one", () => {
    const [moved] = addTab.update(weightsPage(), { type: "key", key: press("up") }, c);
    const [next] = addTab.update(moved, { type: "key", key: press("right") }, c);
    expect(next.weightChoices.get("acme")).toEqual({ kind: "source" });
  });
});

describe("itemIndex", () => {
  it("finds the item of an earlier choice, else the source's weight", () => {
    const profiles = [profile({ brand: "Sunlu", coreWeight: 189 })];
    const items = weightItems(weightGroups(profiles, entries)[0]!, profiles, "SpoolmanDB");
    expect(itemIndex(items, { kind: "grams", grams: 219 })).toBe(1);
    expect(itemIndex(items, { kind: "unspecified" })).toBe(3);
    expect(itemIndex(items, { kind: "grams", grams: 5 })).toBe(2);
    expect(itemIndex(items, undefined)).toBe(2);
  });
});

describe("weightSourceName", () => {
  it("names where the brand's filaments come from", () => {
    expect(weightSourceName(["db", "db"], "mine.json")).toBe("SpoolmanDB");
    expect(weightSourceName(["import"], "mine.json")).toBe("mine.json");
    expect(weightSourceName(["db", "import"], "mine.json")).toBe("SpoolmanDB and mine.json");
  });
});
