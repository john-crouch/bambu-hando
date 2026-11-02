// ABOUTME: Unit tests for the SpoolmanDB brand → material → color browser: rows, moves, selection and levels.
// ABOUTME: The browser is pure state + keys, so it is tested without rendering.

import type { Key } from "ink";
import { describe, expect, it } from "vitest";

import type { FilamentProfile } from "../src/models.js";
import { type BrowseAction, browseInput, browseRows, type BrowseState, initialBrowseState } from "../src/tui/Browse.js";

function key(overrides: Partial<Key> = {}): Key {
  return overrides as Key;
}

function profile(brand: string, material: string, color: string, filamentId: string): FilamentProfile {
  return {
    name: `${brand} ${material} ${color}`,
    brand,
    material,
    colorName: color,
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

const CATALOG = [
  profile("Zeta", "PLA", "White", "Z1"),
  profile("acme", "PLA", "Red", "A1"),
  profile("acme", "PETG", "Black", "A3"),
  profile("acme", "PLA", "Blue", "A2"),
];

const none: ReadonlySet<string> = new Set();
const start = initialBrowseState();

function act(state: BrowseState, input: string, k: Partial<Key> = {}, selected = none): BrowseAction {
  return browseInput(state, input, key(k), CATALOG, selected);
}

function update(state: BrowseState, input: string, k: Partial<Key> = {}, selected = none): { state: BrowseState; selected: ReadonlySet<string> } {
  const action = act(state, input, k, selected);
  if (action.type !== "update") throw new Error(`expected an update, got ${action.type}`);
  return { state: action.state, selected: action.selected ?? selected };
}

const atAcme = { ...start, brand: "acme", cursor: 0, brandCursor: 1 };
const atAcmePla = { ...atAcme, material: "PLA", cursor: 0, materialCursor: 1 };

describe("browseRows", () => {
  it("lists a search row, then brands in alphabetical order with their counts and selections", () => {
    expect(browseRows(start, CATALOG, new Set(["A2"]))).toEqual([
      { kind: "search", label: "Search by name…" },
      { kind: "brand", label: "acme", count: 3, selected: 1 },
      { kind: "brand", label: "Zeta", count: 1, selected: 0 },
    ]);
  });

  it("lists a brand's materials, then a material's colors", () => {
    expect(browseRows(atAcme, CATALOG, none)).toEqual([
      { kind: "material", label: "PETG", count: 1, selected: 0 },
      { kind: "material", label: "PLA", count: 2, selected: 0 },
    ]);
    expect(browseRows(atAcmePla, CATALOG, none).map((r) => r.label)).toEqual(["Blue", "Red"]);
  });
});

describe("browseInput", () => {
  it("opens the name search from its row", () => {
    expect(act(start, "", { return: true })).toEqual({ type: "search" });
  });

  it("drills from a brand into its materials, and from a material into its colors", () => {
    const brand = update({ ...start, cursor: 1 }, "", { return: true }).state;
    expect(brand).toMatchObject({ brand: "acme", material: null, cursor: 0, brandCursor: 1 });

    const material = update({ ...brand, cursor: 1 }, "", { return: true }).state;
    expect(material).toMatchObject({ brand: "acme", material: "PLA", cursor: 0, materialCursor: 1 });
  });

  it("goes straight to the colors of a brand with one material", () => {
    expect(update({ ...start, cursor: 2 }, "", { return: true }).state).toMatchObject({ brand: "Zeta", material: "PLA", cursor: 0 });
  });

  it("goes back up a level with escape, to where the cursor was, and out from the brands", () => {
    expect(update(atAcmePla, "", { escape: true }).state).toMatchObject({ brand: "acme", material: null, cursor: 1 });
    expect(update(atAcme, "", { escape: true }).state).toMatchObject({ brand: null, cursor: 1 });
    expect(update({ ...start, brand: "Zeta", material: "PLA", brandCursor: 2 }, "", { escape: true }).state).toMatchObject({ brand: null, cursor: 2 });
    expect(act(start, "", { escape: true })).toEqual({ type: "back" });
  });

  it("toggles a color with space and moves down", () => {
    const { state, selected } = update(atAcmePla, " ");
    expect([...selected]).toEqual(["A2"]);
    expect(state.cursor).toBe(1);
    expect([...update(atAcmePla, " ", {}, selected).selected]).toEqual([]);
  });

  it("toggles every color of the list with ctrl+a", () => {
    const { selected } = update(atAcmePla, "a", { ctrl: true });
    expect([...selected].sort()).toEqual(["A1", "A2"]);
    expect([...update(atAcmePla, "a", { ctrl: true }, selected).selected]).toEqual([]);
  });

  it("continues with the selection, or with the highlighted color when nothing is selected", () => {
    expect(act({ ...atAcmePla, cursor: 1 }, "", { return: true })).toEqual({ type: "done", selected: new Set(["A1"]) });
    expect(act(atAcmePla, "", { return: true }, new Set(["Z1"]))).toEqual({ type: "done", selected: new Set(["Z1"]) });
  });

  it("jumps to a brand by the first letters typed quickly", () => {
    const brands = ["Siddament", "Snapmaker", "Sunlu"].map((b, i) => profile(b, "PLA", "Black", `B${i}`));
    const s = browseInput(start, "s", key(), brands, none, 0);
    if (s.type !== "update") throw new Error("expected an update");
    const su = browseInput(s.state, "u", key(), brands, none, 100);

    expect(su).toMatchObject({ type: "update", state: { cursor: 3 } });
  });

  it("jumps by first letter and moves with the arrows", () => {
    expect(update(start, "z").state.cursor).toBe(2);
    expect(update(start, "", { downArrow: true }).state.cursor).toBe(1);
    expect(update(atAcmePla, "r").state.cursor).toBe(1);
  });
});
