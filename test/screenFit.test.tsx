// ABOUTME: Rendering tests that each scrolling TUI list fills the terminal's height and never overflows it.
// ABOUTME: A screen taller than the terminal makes Ink redraw it from the top every frame, so each keeps a spare line.

import type { Key } from "ink";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";

import type { FilamentProfile } from "../src/models.js";
import type { CheckSection } from "../src/syncCheck.js";
import { Browse, browseInput, initialBrowseState } from "../src/tui/Browse.js";
import { ChoiceList, choiceInput, initialChoiceState } from "../src/tui/ChoiceList.js";
import { initialPickerState, Picker, pickerInput } from "../src/tui/Picker.js";
import { checkInput, checkRows, SyncCheck } from "../src/tui/SyncCheck.js";
import { WeightMenu, weightItems } from "../src/tui/WeightMenu.js";

function key(overrides: Partial<Key> = {}): Key {
  return overrides as Key;
}

function profile(i: number): FilamentProfile {
  return {
    name: `Acme PLA Color ${i}`,
    brand: "Acme",
    material: "PLA",
    colorName: `Color ${i}`,
    colorRgba: "808080FF",
    nozzleTempMin: 200,
    nozzleTempMax: 220,
    density: 1.24,
    diameter: 1.75,
    slicerFilamentCode: "",
    filamentId: `P${i}`,
    labelWeight: 1000,
    coreWeight: 0,
  };
}

const PROFILES = Array.from({ length: 40 }, (_, i) => profile(i));
const HEIGHT = 20;

function lines(frame: string | undefined): string[] {
  return (frame ?? "").split("\n");
}

/** The frame fits with a spare line, and the list reaches down to it. */
function expectFits(frame: string | undefined): void {
  expect(lines(frame).length).toBeLessThanOrEqual(HEIGHT - 1);
  expect(lines(frame).length).toBeGreaterThanOrEqual(HEIGHT - 3);
}

describe("lists sized to the terminal", () => {
  it("ChoiceList shows as many items as fit and pages by that many", () => {
    const items = PROFILES.map((p) => ({ value: p.filamentId, label: p.name }));
    const state = { ...initialChoiceState(items, []), error: "Tick at least one with space" };
    const { lastFrame } = render(<ChoiceList title="Spools to label" items={items} state={state} multi height={HEIGHT} />);
    expectFits(lastFrame());
    const shown = lines(lastFrame()).filter((line) => line.includes("Acme PLA")).length;
    expect(lastFrame()).toContain(`… ${40 - shown} more`);

    const paged = choiceInput(state, "", key({ pageDown: true }), items, true, 0, shown);
    expect(paged).toMatchObject({ type: "update", state: { cursor: shown } });
  });

  it("Browse fills the height below its warnings", () => {
    const state = { ...initialBrowseState(), brand: "Acme", material: "PLA" };
    const { lastFrame } = render(<Browse state={state} profiles={PROFILES} selected={new Set()} warnings={["Using the cached SpoolmanDB"]} height={HEIGHT} />);
    expectFits(lastFrame());
    const shown = lines(lastFrame()).filter((line) => line.includes("Color ")).length;
    expect(browseInput(state, "", key({ pageDown: true }), PROFILES, new Set(), 0, shown)).toMatchObject({ state: { cursor: shown } });
  });

  it("Picker fills the height below the search line", () => {
    const state = { ...initialPickerState("acme"), error: "Select filaments with tab" };
    const { lastFrame } = render(<Picker catalogSize={40} matches={PROFILES} state={state} warnings={[]} height={HEIGHT} />);
    expectFits(lastFrame());
    const shown = lines(lastFrame()).filter((line) => line.includes("Acme PLA")).length;
    expect(pickerInput(state, "", key({ pageDown: true }), PROFILES, shown)).toMatchObject({ state: { cursor: shown } });
  });

  it("WeightMenu fills the height", () => {
    const group = {
      key: "acme",
      brand: "Acme",
      profiles: [0],
      options: Array.from({ length: 30 }, (_, i) => ({ label: `Acme spool ${i}`, grams: 100 + i, mine: false })),
    };
    const items = weightItems(group, PROFILES, "SpoolmanDB");
    const { lastFrame } = render(
      <WeightMenu group={group} profiles={PROFILES} items={items} cursor={0} step={0} steps={1} sourceName="SpoolmanDB" warnings={[]} height={HEIGHT} />,
    );
    expectFits(lastFrame());
  });

  it("SyncCheck fills the height, scrolled into the middle", () => {
    const sections: CheckSection[] = [
      { key: "presetsOnly", title: "Presets only", why: "Fine.", problem: false, items: PROFILES.map((p) => p.name) },
    ];
    const warnings = ["Couldn't read BambuStudio preset broken.json"];
    const { lastFrame } = render(<SyncCheck sections={sections} top={5} compared="BambuStudio default" warnings={warnings} height={HEIGHT} />);
    expectFits(lastFrame());
    const rows = checkRows(HEIGHT, warnings.length);
    expect(lines(lastFrame()).filter((line) => line.includes("Acme PLA")).length).toBe(rows);
    expect(checkInput(0, "", key({ pageDown: true }), 42, rows)).toEqual({ type: "scroll", top: rows });
  });
});
