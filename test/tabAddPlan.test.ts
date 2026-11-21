// ABOUTME: Tests for the Add tab's plan table data: what each row's run does, notes under it, live progress and the summary.
// ABOUTME: Ported from the old PlanTable's cases, as data the review and run pages draw.

import { describe, expect, it } from "vitest";

import type { SyncResult } from "../src/models.js";
import type { ProfilePlan } from "../src/planPreview.js";
import {
  applyEvent,
  finishedProfiles,
  fitColumns,
  type PlanRow,
  planLayout,
  planNotes,
  planRows,
  presetPlanText,
  runOutcome,
  runPercent,
  shortName,
  spoolEasePlanText,
} from "../src/tui/tabs/add/plan.js";
import { profile } from "./tabAddHarness.js";

const LONG = profile({
  name: "Polymaker PolyLite PETG Galaxy Black",
  brand: "Polymaker",
  material: "PETG",
  colorName: "Galaxy Black",
  filamentId: "P1234567",
  nozzleTempMin: 230,
  nozzleTempMax: 240,
  coreWeight: 140,
});

const plan = (changes: Partial<ProfilePlan>): ProfilePlan => ({
  presets: 1,
  existingPresets: 0,
  nozzleRange: { low: LONG.nozzleTempMin, high: LONG.nozzleTempMax },
  filament: null,
  spool: null,
  ...changes,
});

describe("presetPlanText", () => {
  it("says whether each profile's presets are new, kept or replaced", () => {
    expect(presetPlanText(plan({}), false)).toEqual({ text: "+ new", tone: "new" });
    expect(presetPlanText(plan({ existingPresets: 1 }), false)).toEqual({
      text: "= kept",
      tone: "same",
    });
    expect(presetPlanText(plan({ existingPresets: 1 }), true)).toEqual({
      text: "↻ replace",
      tone: "change",
    });
    expect(presetPlanText(plan({ presets: 2, existingPresets: 1 }), false).text).toBe("1/2 kept");
    expect(presetPlanText(plan({ presets: 2, existingPresets: 1 }), true).text).toBe("1/2 replace");
  });
});

describe("spoolEasePlanText", () => {
  const same = { state: "same" as const, listed: "", becomes: "" };
  const update = { state: "update" as const, listed: "Old 190-210 °C", becomes: "New 200-220 °C" };

  it("says what SpoolEase gets: the custom filament row and the spool", () => {
    expect(
      spoolEasePlanText(
        plan({ filament: { state: "new", listed: "", becomes: "" }, spool: "create" }),
      ),
    ).toEqual({ text: "add + spool", tone: "new" });
    expect(spoolEasePlanText(plan({ filament: update, spool: "create" }))).toEqual({
      text: "update + spool",
      tone: "change",
    });
    expect(spoolEasePlanText(plan({ filament: same, spool: "create" }))?.text).toBe("spool");
    expect(spoolEasePlanText(plan({ filament: same, spool: "exists" }))).toEqual({
      text: "has spool",
      tone: "same",
    });
    expect(spoolEasePlanText(plan({ filament: same }))?.text).toBe("listed");
    expect(spoolEasePlanText(plan({ filament: update }))?.text).toBe("update");
    expect(spoolEasePlanText(plan({}))).toBeNull();
  });
});

describe("planRows", () => {
  const plans = [
    plan({
      existingPresets: 1,
      nozzleRange: { low: 235, high: 250 },
      filament: { state: "new", listed: "", becomes: "" },
      spool: "create",
    }),
  ];

  it("shows each row's plan with the nozzle range SpoolEase gets", () => {
    const [row] = planRows([LONG], plans, [], null, false);
    expect(row).toMatchObject({
      swatch: "#FF0000",
      name: LONG.name,
      brand: "Polymaker",
      material: "PETG",
      temps: "235–250°C",
      code: "P1234567",
      empty: "140 g",
      preset: { kind: "plan", text: "= kept", tone: "same" },
      spool: { kind: "plan", text: "add + spool", tone: "new" },
    });
  });

  it("shows a dash for an unknown empty weight and a dot where SpoolEase wasn't read", () => {
    const [row] = planRows([{ ...LONG, coreWeight: 0 }], null, [], null, false);
    expect(row?.empty).toBe("–");
    expect(row?.temps).toBe("230–240°C");
    expect(row?.preset).toEqual({ kind: "none" });
    expect(row?.spool).toEqual({ kind: "none" });
  });

  it("shows statuses once the run starts, working where the stage is busy", () => {
    const rows = planRows([LONG, LONG], plans, [{ preset: "written" }], "presets", false);
    expect(rows[0]?.preset).toEqual({ kind: "status", status: "written" });
    expect(rows[0]?.spool).toEqual({ kind: "none" });
    expect(rows[1]?.preset).toEqual({ kind: "working" });
    expect(rows[0]?.temps).toBe("235–250°C");
    const spools = planRows([LONG], plans, [{ preset: "skipped" }], "spools", false);
    expect(spools[0]?.spool).toEqual({ kind: "working" });
  });
});

describe("planNotes", () => {
  const edits = new Map([["P1234567", new Map([["filament_flow_ratio", { every: "0.95" }]])]]);

  it("says which presets the plan's edits go into", () => {
    expect(planNotes([LONG], [plan({ presets: 2, existingPresets: 1 })], false, edits)).toEqual([
      { text: "✎ P1234567: 1 change goes into the 1 preset the run writes", tone: "warning" },
      {
        text: "= kept: 1 preset is there already and stays as it is; Overwrite presets in Settings replaces it",
        tone: "muted",
      },
    ]);
    expect(planNotes([LONG], [plan({ presets: 2, existingPresets: 1 })], true, edits)).toEqual([
      { text: "✎ P1234567: 1 change goes into the 2 presets the run writes", tone: "warning" },
    ]);
    expect(planNotes([LONG], [plan({ existingPresets: 1 })], false, edits)[0]).toEqual({
      text: "✎ P1234567: the run keeps its presets, so its 1 change goes nowhere",
      tone: "failed",
    });
  });

  it("explains updates, kept presets and existing spools", () => {
    const plans = [
      plan({
        existingPresets: 1,
        filament: {
          state: "update",
          listed: "Acme Black 200-220 °C",
          becomes: "Acme Black 230-240 °C",
        },
        spool: "exists",
      }),
    ];
    expect(planNotes([LONG], plans, false, new Map()).map((n) => n.text)).toEqual([
      "↻ P1234567 is Acme Black 200-220 °C on SpoolEase; the run changes it to Acme Black 230-240 °C",
      "= kept: 1 preset is there already and stays as it is; Overwrite presets in Settings replaces it",
      "has spool: the console has a spool of it already, so it gets no new one",
    ]);
  });

  it("is empty when there's nothing to explain", () => {
    expect(planNotes([LONG], [plan({})], false, new Map())).toEqual([]);
  });
});

describe("run progress", () => {
  it("records each preset and spool event at its row", () => {
    let progress = applyEvent([], { type: "stage", stage: "presets" });
    expect(progress).toEqual([]);
    progress = applyEvent(progress, {
      type: "preset",
      index: 1,
      status: "written",
      paths: [],
      kept: [],
      error: "",
    });
    progress = applyEvent(progress, { type: "spool", index: 1, status: "failed", detail: "x" });
    expect(progress[1]).toEqual({ preset: "written", spool: "failed" });
  });

  it("counts a profile finished once both statuses are in, and each status as half its share", () => {
    const progress = [
      { preset: "written" as const, spool: "written" as const },
      { preset: "written" as const },
    ];
    expect(finishedProfiles(progress)).toBe(1);
    expect(runPercent(progress, 2)).toBe(75);
    expect(runPercent([], 0)).toBe(0);
  });
});

describe("runOutcome", () => {
  const result = (changes: Partial<SyncResult>): SyncResult => ({
    profileName: "Acme PLA Red",
    filamentId: "P1",
    bambuStatus: "written",
    spooleaseStatus: "written",
    detail: "",
    coreWeight: null,
    spoolId: null,
    ...changes,
  });

  it("sums up a run that went through, with its new spools", () => {
    const outcome = runOutcome(
      [result({ spoolId: "14" }), result({ profileName: "Acme PLA Blue", spoolId: "15" })],
      "SpoolmanDB",
    );
    expect(outcome).toEqual({
      summary: {
        ok: true,
        lines: ["2 filaments from SpoolmanDB: 2 written, 2 new spools"],
      },
      toast: { text: "2 filaments added · 2 new spools", tone: "ok" },
      spoolIds: ["14", "15"],
    });
  });

  it("lists the failed rows and asks for exit code 1", () => {
    const outcome = runOutcome(
      [
        result({}),
        result({ profileName: "Acme PLA Blue", spooleaseStatus: "failed", detail: "HTTP 500" }),
      ],
      "mine.json",
    );
    expect(outcome.summary).toEqual({
      ok: false,
      exitCode: 1,
      lines: ["2 filaments from mine.json: 1 written, 1 failed", "Acme PLA Blue: HTTP 500"],
    });
    expect(outcome.toast).toEqual({ text: "1 of 2 filaments failed", tone: "failed" });
  });
});

describe("fitColumns", () => {
  const widths = { name: 22, brand: 12, code: 9 };
  const shrink = [
    ["name", 10],
    ["brand", 5],
  ] as const;

  it("keeps every column whole when the table fits", () => {
    expect(fitColumns(widths, 200, shrink)).toEqual(widths);
  });

  it("takes columns off in order, each down to its minimum, never the others", () => {
    expect(fitColumns(widths, 29, shrink)).toEqual({ name: 10, brand: 10, code: 9 });
    expect(fitColumns(widths, 10, shrink)).toEqual({ name: 10, brand: 5, code: 9 });
  });
});

describe("shortName", () => {
  it("drops the brand in front and the material word, keeping what tells rows apart", () => {
    expect(shortName("Polymaker PETG PolyLite™ Black", "Polymaker", "PETG", true, true)).toBe(
      "PolyLite™ Black",
    );
    expect(shortName("Polymaker PolyLite™ PETG Black", "Polymaker", "PETG", true, false)).toBe(
      "PolyLite™ PETG Black",
    );
    expect(
      shortName("3D Printing Canada PLA Budget Latte", "3D Printing Canada", "PLA", true, true),
    ).toBe("Budget Latte");
    expect(shortName("Acme PLA", "Acme", "PLA", true, true)).toBe("Acme PLA");
  });
});

describe("planLayout", () => {
  const row = (changes: Partial<PlanRow>): PlanRow => ({
    swatch: "#000000",
    name: "Polymaker PETG PolyLite™ Black",
    brand: "Polymaker",
    material: "PETG",
    temps: "230–240°C",
    code: "Pbed9172",
    empty: "137 g",
    preset: { kind: "plan", text: "+ new", tone: "new" },
    spool: { kind: "plan", text: "add + spool", tone: "new" },
    ...changes,
  });
  const same = [row({}), row({ name: "Polymaker PETG PolyLite™ Blue", code: "Pc994ea3" })];
  const mixed = [...same, row({ name: "Sunlu PLA White", brand: "Sunlu", material: "PLA" })];

  it("moves a brand and material every row shares out of the table, into the title", () => {
    const layout = planLayout(same, 116);
    expect(layout).toMatchObject({ brand: "Polymaker", material: "PETG" });
    expect(layout.widths.brand).toBe(0);
    expect(layout.widths.material).toBe(0);
    expect(layout.stripBrand && layout.stripMaterial).toBe(true);
    expect(layout.widths.code).toBe(8);
  });

  it("shows brand and material columns when rows differ, and strips them from the names", () => {
    const layout = planLayout(mixed, 116);
    expect(layout).toMatchObject({ brand: null, material: null });
    expect(layout.widths.brand).toBeGreaterThan(0);
    expect(layout.widths.material).toBeGreaterThan(0);
    expect(layout.stripBrand && layout.stripMaterial).toBe(true);
  });

  it("drops the code, then the empty weight, before the name is cut", () => {
    const at60 = planLayout(same, 58);
    expect(at60.widths.code).toBe(0);
    expect(at60.widths.name).toBeGreaterThanOrEqual("PolyLite™ Black".length);
    expect(at60.widths.empty).toBeGreaterThan(0);
    const tight = planLayout(same, 46);
    expect(tight.widths.code).toBe(0);
    expect(tight.widths.empty).toBe(0);
  });

  it("gives up brand and material columns on a narrow mixed table, names then whole", () => {
    const layout = planLayout(mixed, 66);
    expect(layout.widths.brand).toBe(0);
    expect(layout.widths.material).toBe(0);
    expect(layout.stripBrand || layout.stripMaterial).toBe(false);
  });

  it("leaves out the SpoolEase column when no row has anything there (SpoolEase skipped)", () => {
    const skipped = same.map((r) => ({ ...r, spool: { kind: "none" as const } }));
    expect(planLayout(skipped, 116).widths.spool).toBe(0);
    const ran = same.map((r) => ({
      ...r,
      spool: { kind: "status" as const, status: "skipped" as const },
    }));
    expect(planLayout(ran, 116).widths.spool).toBe(0);
    expect(planLayout(same, 116).widths.spool).toBeGreaterThan(0);
  });

  it("never lays out more than the width", () => {
    for (const width of [20, 40, 56, 76, 116]) {
      const { widths } = planLayout(mixed, width);
      const cells = Object.values(widths).filter((w) => w > 0);
      const used = cells.reduce((sum, w) => sum + w + 1, 0) - 1 + 5;
      expect(used, `width ${width}`).toBeLessThanOrEqual(Math.max(width, 5 + 7 * 6));
    }
  });
});
