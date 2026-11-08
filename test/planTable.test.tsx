// ABOUTME: Rendering tests for the plan table's columns.
// ABOUTME: Values longer than their column are truncated and still keep a gap before the next column.

import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";

import type { FilamentProfile } from "../src/models.js";
import type { ProfilePlan } from "../src/planPreview.js";
import { PlanNotes, PlanTable, presetPlanText, spoolEasePlanText } from "../src/tui/PlanTable.js";

const LONG: FilamentProfile = {
  name: "Acme Extraordinarily Long Filament Name Black",
  brand: "Acmecorporation",
  material: "PETG",
  colorName: "Black",
  colorRgba: "000000FF",
  nozzleTempMin: 230,
  nozzleTempMax: 240,
  density: 1.27,
  diameter: 1.75,
  slicerFilamentCode: "",
  filamentId: "P1234567",
  labelWeight: 1000,
  coreWeight: 140,
};

describe("PlanTable", () => {
  it("keeps a gap after a value truncated to its column", () => {
    const { lastFrame } = render(<PlanTable profiles={[LONG]} progress={[]} activePresets={false} activeSpools={false} />);

    const frame = lastFrame() ?? "";
    expect(frame).toMatch(/Acme Extraordinar\S*… +Acmecorp\S*… +PETG +230-240/);
    expect(frame).toContain("Nozzle°C");
  });
});

describe("the plan, before a run", () => {
  const plan = (changes: Partial<ProfilePlan>): ProfilePlan => ({ presets: 1, existingPresets: 0, filament: null, spool: null, ...changes });

  it("says whether each profile's presets are new, kept or replaced", () => {
    expect(presetPlanText(plan({}), false).text).toBe("+ new");
    expect(presetPlanText(plan({ existingPresets: 1 }), false).text).toBe("= kept");
    expect(presetPlanText(plan({ existingPresets: 1 }), true).text).toBe("↻ replace");
    expect(presetPlanText(plan({ presets: 2, existingPresets: 1 }), false).text).toBe("1/2 kept");
    expect(presetPlanText(plan({ presets: 2, existingPresets: 1 }), true).text).toBe("1/2 replace");
  });

  it("says what SpoolEase gets: the custom filament row and the spool", () => {
    const update = { state: "update" as const, listed: "Old 190-210 °C", becomes: "New 200-220 °C" };
    expect(spoolEasePlanText(plan({ filament: { state: "new", listed: "", becomes: "" }, spool: "create" }))?.text).toBe("add + spool");
    expect(spoolEasePlanText(plan({ filament: update, spool: "create" }))?.text).toBe("update + spool");
    expect(spoolEasePlanText(plan({ filament: { state: "same", listed: "", becomes: "" }, spool: "create" }))?.text).toBe("spool");
    expect(spoolEasePlanText(plan({ filament: { state: "same", listed: "", becomes: "" }, spool: "exists" }))?.text).toBe("has spool");
    expect(spoolEasePlanText(plan({ filament: { state: "same", listed: "", becomes: "" } }))?.text).toBe("listed");
    expect(spoolEasePlanText(plan({ filament: update }))?.text).toBe("update");
    expect(spoolEasePlanText(plan({}))).toBeNull();
  });

  it("shows the plan in the status columns until the run reports", () => {
    const plans = [plan({ existingPresets: 1, filament: { state: "new", listed: "", becomes: "" }, spool: "create" })];
    const { lastFrame } = render(<PlanTable profiles={[LONG]} progress={[]} plans={plans} overwrite={false} activePresets={false} activeSpools={false} />);
    expect(lastFrame()).toMatch(/= kept +add \+ spool/);

    const running = render(<PlanTable profiles={[LONG]} progress={[{ preset: "skipped" }]} plans={plans} overwrite={false} activePresets={false} activeSpools />);
    expect(running.lastFrame()).toContain("– skipped");
    expect(running.lastFrame()).not.toContain("add + spool");
  });

  it("explains updates, kept presets and existing spools under the table", () => {
    const plans = [
      plan({ existingPresets: 1, filament: { state: "update", listed: "Acme Black 200-220 °C", becomes: "Acme Black 230-240 °C" }, spool: "exists" }),
    ];
    const { lastFrame } = render(<PlanNotes profiles={[LONG]} plans={plans} overwrite={false} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("↻ P1234567 is Acme Black 200-220 °C on SpoolEase; the run changes it to Acme Black 230-240 °C");
    expect(frame).toContain("= kept: 1 preset is there already and stays as it is (Overwrite presets in Settings replaces it)");
    expect(frame).toContain("has spool: the console has a spool of 1 filament already, so it gets no new one");
  });
});
