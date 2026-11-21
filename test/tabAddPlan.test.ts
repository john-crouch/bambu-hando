// ABOUTME: Tests for the Add tab's plan table data: what each row's run does, notes under it, live progress and the summary.
// ABOUTME: Ported from the old PlanTable's cases, as data the review and run pages draw.

import { describe, expect, it } from "vitest";

import type { SyncResult } from "../src/models.js";
import type { ProfilePlan } from "../src/planPreview.js";
import {
  applyEvent,
  finishedProfiles,
  fitColumns,
  PLAN_COLUMNS,
  PLAN_SHRINK,
  planNotes,
  planRows,
  presetPlanText,
  runOutcome,
  runPercent,
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
        text: "= kept: 1 preset is there already and stays as it is (Overwrite presets in Settings replaces it)",
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
      "= kept: 1 preset is there already and stays as it is (Overwrite presets in Settings replaces it)",
      "has spool: the console has a spool of 1 filament already, so it gets no new one",
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
        lines: ["2 filaments from SpoolmanDB: 2 written, 0 failed, 2 new spools"],
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
  it("keeps every column whole when the table fits", () => {
    expect(fitColumns(PLAN_COLUMNS, 200, PLAN_SHRINK)).toEqual(PLAN_COLUMNS);
  });

  it("takes columns off the name first, then the brand, and never the code", () => {
    const total = Object.values(PLAN_COLUMNS).reduce((a, b) => a + b, 0);
    const fitted = fitColumns(PLAN_COLUMNS, total - 14, PLAN_SHRINK);
    expect(fitted.name).toBe(PLAN_COLUMNS.name - 12);
    expect(fitted.brand).toBe(PLAN_COLUMNS.brand - 2);
    expect(fitted.code).toBe(PLAN_COLUMNS.code);
    const tight = fitColumns(PLAN_COLUMNS, 20, PLAN_SHRINK);
    expect(tight.code).toBe(PLAN_COLUMNS.code);
    expect(tight.name).toBe(6);
  });
});
