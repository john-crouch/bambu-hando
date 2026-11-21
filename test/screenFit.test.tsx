// ABOUTME: Rendering tests that each scrolling TUI list fills the terminal's height and never overflows it.
// ABOUTME: A screen taller than the terminal makes Ink redraw it from the top every frame, so each keeps a spare line.

import type { Key } from "ink";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";

import type { FilamentProfile } from "../src/models.js";
import { EDIT_FIELDS } from "../src/presetEdit.js";
import { inventoryRows } from "../src/spoolInventory.js";
import type { CheckSection } from "../src/syncCheck.js";
import { Browse, browseInput, initialBrowseState } from "../src/tui/Browse.js";
import { ChoiceList, choiceInput, initialChoiceState } from "../src/tui/ChoiceList.js";
import { HomeMenu } from "../src/tui/HomeMenu.js";
import { initialPickerState, Picker, pickerInput } from "../src/tui/Picker.js";
import {
  initialPresetForm,
  PresetForm,
  presetFormInput,
  presetFormRows,
} from "../src/tui/PresetForm.js";
import { initialPresetList, PresetList, presetListInput } from "../src/tui/PresetList.js";
import { initialRawSettings, RawSettings, rawInput, rawKeys } from "../src/tui/RawSettings.js";
import { initialSpoolList, SpoolList, spoolListInput } from "../src/tui/SpoolList.js";
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
    const { lastFrame } = render(
      <ChoiceList title="Spools to label" items={items} state={state} multi height={HEIGHT} />,
    );
    expectFits(lastFrame());
    const shown = lines(lastFrame()).filter((line) => line.includes("Acme PLA")).length;
    expect(lastFrame()).toContain(`… ${40 - shown} more`);

    const paged = choiceInput(state, "", key({ pageDown: true }), items, true, 0, shown);
    expect(paged).toMatchObject({ type: "update", state: { cursor: shown } });
  });

  it("Browse fills the height below its warnings", () => {
    const state = { ...initialBrowseState(), brand: "Acme", material: "PLA" };
    const { lastFrame } = render(
      <Browse
        state={state}
        profiles={PROFILES}
        selected={new Set()}
        warnings={["Using the cached SpoolmanDB"]}
        height={HEIGHT}
      />,
    );
    expectFits(lastFrame());
    const shown = lines(lastFrame()).filter((line) => line.includes("Color ")).length;
    expect(
      browseInput(state, "", key({ pageDown: true }), PROFILES, new Set(), 0, shown),
    ).toMatchObject({ state: { cursor: shown } });
  });

  it("Picker fills the height below the search line", () => {
    const state = { ...initialPickerState("acme"), error: "Select filaments with tab" };
    const { lastFrame } = render(
      <Picker catalogSize={40} matches={PROFILES} state={state} warnings={[]} height={HEIGHT} />,
    );
    expectFits(lastFrame());
    const shown = lines(lastFrame()).filter((line) => line.includes("Acme PLA")).length;
    expect(pickerInput(state, "", key({ pageDown: true }), PROFILES, shown)).toMatchObject({
      state: { cursor: shown },
    });
  });

  it("WeightMenu fills the height", () => {
    const group = {
      key: "acme",
      brand: "Acme",
      profiles: [0],
      options: Array.from({ length: 30 }, (_, i) => ({
        label: `Acme spool ${i}`,
        grams: 100 + i,
        mine: false,
      })),
    };
    const items = weightItems(group, PROFILES, "SpoolmanDB");
    const { lastFrame } = render(
      <WeightMenu
        group={group}
        profiles={PROFILES}
        items={items}
        cursor={0}
        step={0}
        steps={1}
        sourceName="SpoolmanDB"
        warnings={[]}
        height={HEIGHT}
      />,
    );
    expectFits(lastFrame());
  });

  it("SpoolList fills the height below its filter and column header", () => {
    const spools = PROFILES.map((p, i) => ({
      id: String(i + 1),
      tagId: "",
      material: "PLA",
      subtype: "",
      colorName: p.colorName,
      colorCodes: [],
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
    }));
    const rows = inventoryRows(spools, new Map(), "", "newest");
    const { lastFrame } = render(
      <SpoolList rows={rows} total={40} state={initialSpoolList()} height={HEIGHT} />,
    );
    expectFits(lastFrame());
    const shown = lines(lastFrame()).filter((line) => line.includes("Acme PLA")).length;
    expect(
      spoolListInput(initialSpoolList(), "", key({ pageDown: true }), 40, shown),
    ).toMatchObject({ state: { cursor: shown } });
  });

  it("PresetList fills the height below its warnings and filter", () => {
    const presets = PROFILES.map((p) => ({
      name: p.name,
      filamentId: p.filamentId,
      printer: "Bambu Lab X1 Carbon 0.4 nozzle",
      path: `/p/${p.name}.json`,
    }));
    const warnings = ["Couldn't read BambuStudio preset broken.json"];
    const { lastFrame } = render(
      <PresetList
        matches={presets}
        total={40}
        folder="BambuStudio folder default"
        drafts={new Set()}
        state={initialPresetList()}
        warnings={warnings}
        height={HEIGHT}
      />,
    );
    expectFits(lastFrame());
    const shown = lines(lastFrame()).filter((line) => line.includes("Acme PLA")).length;
    expect(
      presetListInput(initialPresetList(), "", key({ pageDown: true }), 40, shown),
    ).toMatchObject({ state: { cursor: shown } });
  });

  const PRESET = {
    name: "Acme PLA Red @Bambu Lab X1 Carbon 0.4 nozzle",
    ...Object.fromEntries(PROFILES.map((p) => [`setting_${p.filamentId}`, ["1"]])),
  };
  const OPENED = {
    name: "Acme PLA Red",
    filamentId: "PA000001",
    printer: "Bambu Lab X1 Carbon 0.4 nozzle",
    path: "/p/Acme PLA Red.json",
  };

  it("PresetForm fills the height and pages by as many fields as it shows", () => {
    const { lastFrame } = render(
      <PresetForm
        preset={OPENED}
        original={PRESET}
        edited={PRESET}
        edits={new Map()}
        state={initialPresetForm()}
        height={HEIGHT}
      />,
    );
    expectFits(lastFrame());
    // The curated fields, then All settings and Review and save.
    const shown = presetFormRows(HEIGHT);
    expect(lastFrame()).toContain(`… ${EDIT_FIELDS.length + 2 - shown} more`);
    const paged = presetFormInput(initialPresetForm(), "", key({ pageDown: true }), PRESET, shown);
    expect(paged).toMatchObject({ state: { cursor: shown } });
  });

  it("RawSettings fills the height below its filter", () => {
    const { lastFrame } = render(
      <RawSettings
        preset={OPENED}
        edited={PRESET}
        edits={new Map()}
        state={initialRawSettings()}
        height={HEIGHT}
      />,
    );
    expectFits(lastFrame());
    const shown = lines(lastFrame()).filter((line) => line.includes("setting_")).length;
    const keys = rawKeys(PRESET, "");
    expect(
      rawInput(initialRawSettings(), "", key({ pageDown: true }), keys, PRESET, shown),
    ).toMatchObject({ state: { cursor: shown } });
  });

  it("SyncCheck fills the height, scrolled into the middle", () => {
    const sections: CheckSection[] = [
      {
        key: "presetsOnly",
        title: "Presets only",
        why: "Fine.",
        problem: false,
        items: PROFILES.map((p) => p.name),
      },
    ];
    const warnings = ["Couldn't read BambuStudio preset broken.json"];
    const { lastFrame } = render(
      <SyncCheck
        sections={sections}
        top={5}
        compared="BambuStudio default"
        warnings={warnings}
        height={HEIGHT}
      />,
    );
    expectFits(lastFrame());
    const rows = checkRows(HEIGHT, warnings.length);
    expect(lines(lastFrame()).filter((line) => line.includes("Acme PLA")).length).toBe(rows);
    expect(checkInput(0, "", key({ pageDown: true }), 42, rows)).toEqual({
      type: "scroll",
      top: rows,
    });
  });
});

describe("rows too wide for the terminal", () => {
  // ink-testing-library renders 100 columns wide.
  const LONG =
    "a detail long enough to run past the right edge of a 100-column terminal and wrap if it could";

  it("keep the menu's labels in one column and cut the detail", () => {
    const items = [
      { id: "spoolmandb" as const, label: "Add spools from SpoolmanDB", detail: LONG },
      { id: "settings" as const, label: "Settings", detail: LONG },
    ];
    const { lastFrame } = render(<HomeMenu items={items} cursor={0} context={[]} outcome={null} />);
    const rows = lines(lastFrame()).filter((line) => line.includes("a detail"));
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.indexOf("a detail"))).toEqual([
      rows[0]!.indexOf("a detail"),
      rows[0]!.indexOf("a detail"),
    ]);
    // The cursor column keeps its width too: Ink measures the cut detail's "…" a column wide.
    expect(rows[0]).toMatch(/^› Add spools/);
    expect(rows[1]).toMatch(/^ {2}Settings/);
    expect(rows.every((row) => row.trimEnd().endsWith("…"))).toBe(true);
  });

  it("keep a choice list's labels in one column and cut the detail", () => {
    const items = [
      { value: "1", label: "Acme PLA Red", detail: LONG },
      { value: "2", label: "Acme PLA Blue", detail: LONG },
    ];
    const { lastFrame } = render(
      <ChoiceList title="Pick" items={items} state={initialChoiceState(items, [])} multi={false} />,
    );
    const rows = lines(lastFrame()).filter((line) => line.includes("a detail"));
    expect(rows).toHaveLength(2);
    expect(rows[0]!.indexOf("a detail")).toBe(rows[1]!.indexOf("a detail"));
    expect(rows.every((row) => row.trimEnd().endsWith("…"))).toBe(true);
  });
});
