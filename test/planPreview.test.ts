// ABOUTME: Unit tests for the plan preview: what a run would do to each profile's presets, custom filament row and spool.
// ABOUTME: Presets are looked up in a temporary HOME; SpoolEase's state is passed in as read.

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { presetPath } from "../src/bambuStudio.js";
import type { FilamentProfile } from "../src/models.js";
import { filamentPlan, previewPlan } from "../src/planPreview.js";

function profile(name: string, filamentId: string): FilamentProfile {
  return {
    name,
    brand: "Acme",
    material: "PLA",
    colorName: "Red",
    colorRgba: "FF0000FF",
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

const RED = profile("Acme PLA Red", "P1111111");
const BLUE = profile("Acme PLA Blue", "P2222222");

describe("filamentPlan", () => {
  it("adds a filament SpoolEase doesn't list", () => {
    expect(filamentPlan(RED, "P9999999,Other,190,210,PLA")).toEqual({
      state: "new",
      listed: "",
      becomes: "",
    });
  });

  it("leaves a row that already says the same", () => {
    expect(
      filamentPlan(RED, "P9999999,Other,190,210,PLA\r\nP1111111,Acme PLA Red,200,220,PLA"),
    ).toEqual({ state: "same", listed: "", becomes: "" });
  });

  it("updates a row whose name, temperatures or material differ, saying what it is now", () => {
    expect(filamentPlan(RED, "P1111111,Acme Red,190,230,PLA")).toEqual({
      state: "update",
      listed: "Acme Red 190-230 °C",
      becomes: "Acme PLA Red 200-220 °C",
    });
  });
});

describe("previewPlan", () => {
  let home: string;
  const printers = ["Printer A", "Printer B"];

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "bambu-hando-plan-"));
    vi.stubEnv("HOME", home);
  });

  async function existing(p: FilamentProfile, printer: string, preset: object = {}): Promise<void> {
    const path = presetPath(p, "default", printer);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(preset));
  }

  it("counts each profile's presets that exist, and checks its row and spool", async () => {
    await existing(RED, "Printer A");
    await existing(BLUE, "Printer A");
    await existing(BLUE, "Printer B");
    const spoolease = {
      csv: "P1111111,Acme PLA Red,200,220,PLA",
      spooledIds: new Set(["P1111111"]),
    };

    const plans = await previewPlan(
      [RED, BLUE],
      { presetFolder: "default", printers },
      spoolease,
      true,
    );

    expect(plans).toEqual([
      {
        presets: 2,
        existingPresets: 1,
        nozzleRange: { low: 200, high: 220 },
        filament: { state: "same", listed: "", becomes: "" },
        spool: "exists",
      },
      {
        presets: 2,
        existingPresets: 2,
        nozzleRange: { low: 200, high: 220 },
        filament: { state: "new", listed: "", becomes: "" },
        spool: "create",
      },
    ]);
  });

  it("leaves SpoolEase out when it wasn't read, and spools out when none are created", async () => {
    const [unread] = await previewPlan([RED], { presetFolder: "default", printers }, null, true);
    expect(unread).toEqual({
      presets: 2,
      existingPresets: 0,
      nozzleRange: { low: 200, high: 220 },
      filament: null,
      spool: null,
    });

    const [noSpools] = await previewPlan(
      [RED],
      { presetFolder: "default", printers },
      { csv: "", spooledIds: new Set() },
      false,
    );
    expect(noSpools).toMatchObject({ filament: { state: "new" }, spool: null });
  });

  it("shows the range a kept preset gives SpoolEase, unless overwriting replaces it", async () => {
    await existing(RED, "Printer B", {
      nozzle_temperature_range_low: ["210"],
      nozzle_temperature_range_high: ["235"],
    });
    const spoolease = { csv: "P1111111,Acme PLA Red,200,220,PLA", spooledIds: new Set<string>() };

    const [kept] = await previewPlan(
      [RED],
      { presetFolder: "default", printers },
      spoolease,
      false,
    );
    expect(kept).toMatchObject({
      nozzleRange: { low: 210, high: 235 },
      filament: { state: "update", becomes: "Acme PLA Red 210-235 °C" },
    });

    const [replaced] = await previewPlan(
      [RED],
      { presetFolder: "default", printers },
      spoolease,
      false,
      { overwrite: true },
    );
    expect(replaced).toMatchObject({
      nozzleRange: { low: 200, high: 220 },
      filament: { state: "same" },
    });
  });

  it("shows the range the plan's edits give the presets the run writes", async () => {
    const edits = new Map([
      ["P1111111", new Map([["nozzle_temperature_range_low", { every: "195" }]])],
    ]);

    const [edited] = await previewPlan(
      [RED],
      { presetFolder: "default", printers },
      { csv: "", spooledIds: new Set() },
      false,
      { edits },
    );

    expect(edited).toMatchObject({
      nozzleRange: { low: 195, high: 220 },
      filament: { state: "new" },
    });
  });
});
