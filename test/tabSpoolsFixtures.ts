// ABOUTME: Shared fixtures for the Spools tab and labels overlay tests: settings, spool records, a Ctx, and a Cmd runner.
// ABOUTME: Commands run for real against whatever the test points the settings at (the stand-in SpoolEase server).

import type { CustomFilament, SpoolRecord } from "../src/spoolease.js";
import type { Cmd } from "../src/tui/core/program.js";
import type { AppMsg, ConsoleData, Ctx, Resource, Resources } from "../src/tui/core/types.js";
import type { FormValues } from "../src/tui/core/values.js";

export const VALUES: FormValues = {
  source: "spoolmandb",
  presetFolder: "default",
  printerPreset: "Bambu Lab X1 Carbon 0.4 nozzle",
  overwritePresets: false,
  host: "127.0.0.1",
  port: "80",
  securityKey: "SECRETKEY",
  https: false,
  skipSpoolease: false,
  createSpools: true,
  query: "",
  diameter: 1.75,
};

export function spool(overrides: Partial<SpoolRecord>): SpoolRecord {
  return {
    id: "1",
    tagId: "",
    material: "PETG",
    subtype: "",
    colorName: "Red",
    colorCodes: ["BC2726FF"],
    note: "",
    brand: "Acme",
    labelWeight: 1000,
    coreWeight: 200,
    fullWeight: null,
    currentWeight: null,
    consumedSinceWeighed: 0,
    slicerFilament: "P1111111",
    addedTime: null,
    location: "",
    ...overrides,
  };
}

export const FILAMENTS = new Map<string, CustomFilament>([
  ["P1111111", { name: "Acme PETG Red", nozzleTempMin: 230, nozzleTempMax: 250 }],
  ["P2222222", { name: "Zeta PLA Blue", nozzleTempMin: 190, nozzleTempMax: 220 }],
]);

export function ready<T>(value: T): Resource<T> {
  return { state: "ready", value, at: 0 };
}

export function consoleOf(spools: SpoolRecord[], filaments = FILAMENTS): Resource<ConsoleData> {
  return ready({ spools, filaments });
}

export function makeCtx(
  overrides: { values?: Partial<FormValues>; resources?: Partial<Resources> } = {},
): Ctx {
  return {
    values: { ...VALUES, ...overrides.values },
    resources: {
      console: { state: "idle" },
      presets: { state: "idle" },
      catalog: { state: "idle" },
      check: { state: "idle" },
      ...overrides.resources,
    },
    columns: 100,
    rows: 30,
    bodyColumns: 100,
    bodyRows: 28,
    now: Date.UTC(2026, 10, 21),
  };
}

/** Runs commands like the Program does and returns every message they dispatched, in order. */
export async function runCmds(cmds: Cmd<AppMsg>[]): Promise<AppMsg[]> {
  const seen: AppMsg[] = [];
  for (const cmd of cmds) await cmd((msg) => seen.push(msg));
  return seen;
}
