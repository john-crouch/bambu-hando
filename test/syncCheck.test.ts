// ABOUTME: Tests the read-only sync check: BambuStudio presets vs SpoolEase's custom filaments vs its spools.
// ABOUTME: Presets are read from a temporary HOME; the comparison itself is pure.

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SpoolRecord } from "../src/spoolease.js";
import { checkSync, readUserPresets, type UserPreset } from "../src/syncCheck.js";
import { baseFilamentDir } from "./bambuStudioSetup.js";

function spool(overrides: Partial<SpoolRecord>): SpoolRecord {
  return {
    id: "1",
    tagId: "",
    material: "PLA",
    subtype: "",
    colorName: "Red",
    colorCodes: [],
    note: "",
    brand: "Acme",
    labelWeight: null,
    coreWeight: null,
    fullWeight: null,
    slicerFilament: "",
    addedTime: null,
    location: "",
    ...overrides,
  };
}

describe("readUserPresets", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "bambu-hando-check-"));
    vi.stubEnv("HOME", home);
  });

  it("reads the filament ID and name of the folder's own presets, skipping ones that inherit a system preset", async () => {
    // A "null" filament_id is no ID at all; it was seen in real presets made outside BambuStudio's Create filament.
    const base = baseFilamentDir(home);
    await mkdir(base, { recursive: true });
    await writeFile(join(base, "Acme PLA Red @Printer A.json"), JSON.stringify({ name: "Acme PLA Red @Printer A", inherits: "", filament_id: "PA000001" }));
    await writeFile(join(base, "Acme PLA Red @Printer A.info"), "sync_info = \n");
    await writeFile(join(base, "broken.json"), "{");
    await writeFile(join(base, "Rock @Printer A.json"), JSON.stringify({ name: "Rock @Printer A", inherits: "", filament_id: "null" }));
    await writeFile(join(base, "..", "Bambu PLA Basic - Mine.json"), JSON.stringify({ name: "Bambu PLA Basic - Mine", inherits: "Bambu PLA Basic" }));
    await writeFile(join(base, "..", "Own @Printer B.json"), JSON.stringify({ inherits: "", filament_id: "PA000002" }));

    const { presets, warnings } = await readUserPresets("default");

    expect(presets).toEqual([
      { name: "Acme PLA Red", filamentId: "PA000001", printer: "Printer A", path: join(base, "Acme PLA Red @Printer A.json") },
      { name: "Rock", filamentId: "", printer: "Printer A", path: join(base, "Rock @Printer A.json") },
      { name: "Own", filamentId: "PA000002", printer: "Printer B", path: join(base, "..", "Own @Printer B.json") },
    ]);
    expect(warnings).toEqual([expect.stringMatching(/^Couldn't read BambuStudio preset .*broken\.json: /)]);
  });

  it("finds no presets in a folder that doesn't exist", async () => {
    expect(await readUserPresets("nobody")).toEqual({ presets: [], warnings: [] });
  });
});

describe("checkSync", () => {
  const presets: UserPreset[] = [
    { name: "Acme PLA Red", filamentId: "PA000001", printer: "Printer A", path: "" },
    { name: "Acme PLA Red", filamentId: "PA000001", printer: "Printer B", path: "" },
    { name: "Studio Only", filamentId: "PA000009", printer: "Printer A", path: "" },
  ];
  const csv = "PA000001,Acme PLA Red,200,220,PLA\r\nPA000002,No Preset,200,220,PLA";

  function section(key: string, report = checkSync({ presets, csv, spools: [] })) {
    return report.find((s) => s.key === key)!;
  }

  it("finds nothing to report when the three agree", () => {
    const report = checkSync({ presets: presets.slice(0, 2), csv: csv.split("\r\n")[0]!, spools: [spool({ slicerFilament: "PA000001" })] });

    expect(report.map((s) => [s.key, s.items])).toEqual([
      ["csvOnly", []],
      ["unknownCode", []],
      ["badRows", []],
      ["presetsOnly", []],
      ["presetsNoId", []],
      ["noCode", []],
    ]);
  });

  it("lists custom filaments without a preset, as problems", () => {
    expect(section("csvOnly")).toMatchObject({ problem: true, items: ["No Preset (PA000002)"] });
  });

  it("lists presets SpoolEase doesn't know once per filament, as notes", () => {
    expect(section("presetsOnly")).toMatchObject({ problem: false, items: ["Studio Only (PA000009) · Printer A"] });
  });

  it("lists presets without a filament ID once per filament, as notes", () => {
    const noId = [...presets, { name: "Rock", filamentId: "", printer: "Printer A", path: "" }, { name: "Rock", filamentId: "", printer: "Printer B", path: "" }];

    expect(section("presetsNoId", checkSync({ presets: noId, csv, spools: [] }))).toMatchObject({ problem: false, items: ["Rock · Printer A, Printer B"] });
    expect(section("presetsOnly", checkSync({ presets: noId, csv, spools: [] })).items).toEqual(["Studio Only (PA000009) · Printer A"]);
  });

  it("lists spools whose code is neither a custom filament nor a Bambu Lab one, newest first", () => {
    const spools = [
      spool({ id: "2", slicerFilament: "PZZZZZZ1" }),
      spool({ id: "10", slicerFilament: "PZZZZZZ2", colorName: "" }),
      spool({ id: "3", slicerFilament: "GFA00" }),
      spool({ id: "4", slicerFilament: "PA000001" }),
    ];

    expect(section("unknownCode", checkSync({ presets, csv, spools }))).toMatchObject({
      problem: true,
      items: ["#10 Acme PLA (PZZZZZZ2)", "#2 Acme PLA Red (PZZZZZZ1)"],
    });
  });

  it("lists spools without a filament code, as notes", () => {
    expect(section("noCode", checkSync({ presets, csv, spools: [spool({ id: "5" })] }))).toMatchObject({ problem: false, items: ["#5 Acme PLA Red"] });
  });

  it("lists custom filament rows SpoolEase would misread, and repeated codes", () => {
    const rows = "PA000001,Acme PLA Red,200,220,PLA\r\n\r\nPA000003,Silk, Gold,200,220,PLA\r\nPA000004,Short,200\r\nPA000001,Again,200,220,PLA";

    expect(section("badRows", checkSync({ presets, csv: rows, spools: [] })).items).toEqual([
      "row 2: PA000003,Silk, Gold,200,220,PLA",
      "row 3: PA000004,Short,200",
      "row 4: PA000001 again (row 1 has it)",
    ]);
  });
});
