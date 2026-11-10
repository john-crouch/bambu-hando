// ABOUTME: Tests for editing BambuStudio filament presets: curated fields, raw settings, sibling presets and writing.
// ABOUTME: Writes real preset and .info files in a temporary folder and reads them back.

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import {
  applyEdits,
  editChanges,
  EDIT_FIELDS,
  editField,
  fieldText,
  lockedReason,
  nozzleRange,
  parseField,
  parseRaw,
  presetFamily,
  rangeError,
  rawText,
  shownValue,
  writePresetEdits,
} from "../src/presetEdit.js";
import { withNozzleRange } from "../src/spoolease.js";

const field = (key: string) => editField(key)!;

const PRESET = {
  name: "Acme PLA Red @Bambu Lab X1 Carbon 0.4 nozzle",
  filament_id: "PA000001",
  nozzle_temperature: ["220"],
  nozzle_temperature_range_low: ["190"],
  nozzle_temperature_range_high: ["230"],
  filament_retraction_length: ["nil", "0.4"],
  filament_retraction_speed: ["nil", "nil"],
  enable_pressure_advance: ["0"],
  default_filament_colour: [""],
  filament_notes: "",
  filament_start_gcode: ["; start\nM400"],
  filament_extruder_variant: ["Direct Drive Standard", "Direct Drive High Flow"],
  empty_list: [],
};

describe("curated fields", () => {
  it("groups the settings people tune, each once", () => {
    const keys = EDIT_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(expect.arrayContaining(["nozzle_temperature", "textured_plate_temp", "filament_flow_ratio", "pressure_advance", "fan_max_speed", "filament_density", "filament_notes"]));
    expect(editField("filament_start_gcode")).toBeUndefined();
  });

  it("shows a value with its unit, per variant when they differ, and names the special values", () => {
    expect(shownValue(field("nozzle_temperature"), PRESET.nozzle_temperature)).toBe("220 °C");
    expect(shownValue(field("filament_retraction_length"), PRESET.filament_retraction_length)).toBe("printer's / 0.4 mm");
    expect(shownValue(field("filament_retraction_speed"), PRESET.filament_retraction_speed)).toBe("printer's");
    expect(shownValue(field("enable_pressure_advance"), ["0"])).toBe("off");
    expect(shownValue(field("enable_pressure_advance"), ["1"])).toBe("on");
    expect(shownValue(field("default_filament_colour"), [""])).toBe("none");
    expect(shownValue(field("default_filament_colour"), ["#ad0000"])).toBe("#AD0000");
    expect(shownValue(field("filament_notes"), "")).toBe("none");
    expect(shownValue(field("filament_notes"), "Dry first\nthen print")).toBe("Dry first\\nthen print");
    expect(shownValue(field("pressure_advance"), undefined)).toBe("not set");
  });

  it("starts editing from the first variant, with nil as nothing", () => {
    expect(fieldText(field("nozzle_temperature"), ["220"])).toBe("220");
    expect(fieldText(field("filament_retraction_length"), ["nil", "0.4"])).toBe("");
    expect(fieldText(field("filament_notes"), "a\nb")).toBe("a\\nb");
    expect(fieldText(field("default_filament_colour"), ["#AD0000"])).toBe("AD0000");
    expect(fieldText(field("pressure_advance"), undefined)).toBe("");
  });

  it("takes whole numbers and decimals within the field's range", () => {
    expect(parseField(field("nozzle_temperature"), " 215 ")).toEqual({ value: "215" });
    expect(parseField(field("nozzle_temperature"), "215.5")).toEqual({ error: "Nozzle: type a whole number from 0 to 500" });
    expect(parseField(field("nozzle_temperature"), "")).toEqual({ error: "Nozzle: type a whole number from 0 to 500" });
    expect(parseField(field("filament_flow_ratio"), "0.98")).toEqual({ value: "0.98" });
    expect(parseField(field("filament_flow_ratio"), ".98")).toEqual({ value: "0.98" });
    expect(parseField(field("filament_flow_ratio"), "3")).toMatchObject({ error: expect.stringContaining("Flow ratio") });
    expect(parseField(field("fan_max_speed"), "101")).toMatchObject({ error: expect.stringContaining("0 to 100") });
  });

  it("turns nothing typed into the printer's value where a field has one", () => {
    expect(parseField(field("filament_retraction_length"), "")).toEqual({ value: "nil" });
    expect(parseField(field("filament_retraction_length"), "0.8")).toEqual({ value: "0.8" });
  });

  it("takes a color as 6 hex digits, or nothing for none, and notes as any text", () => {
    expect(parseField(field("default_filament_colour"), "ad0000")).toEqual({ value: "#AD0000" });
    expect(parseField(field("default_filament_colour"), "#AD0000")).toEqual({ value: "#AD0000" });
    expect(parseField(field("default_filament_colour"), "")).toEqual({ value: "" });
    expect(parseField(field("default_filament_colour"), "red")).toMatchObject({ error: expect.stringContaining("6 hex digits") });
    expect(parseField(field("filament_notes"), "Dry 8 h\\nat 55 °C")).toEqual({ value: "Dry 8 h\nat 55 °C" });
  });
});

describe("raw settings", () => {
  it("shows strings and lists of one value as text, with newlines as \\n, and lists that differ as JSON", () => {
    expect(rawText(PRESET.filament_start_gcode)).toBe("; start\\nM400");
    expect(rawText("a\\b")).toBe("a\\\\b");
    expect(rawText(PRESET.filament_retraction_speed)).toBe("nil");
    expect(rawText(PRESET.filament_extruder_variant)).toBe('["Direct Drive Standard","Direct Drive High Flow"]');
    expect(rawText(PRESET.empty_list)).toBe("");
    expect(rawText(7)).toBeNull();
  });

  it("reads text back the way it was shown", () => {
    expect(parseRaw(PRESET.filament_start_gcode, "; start\\nM400\\nG28")).toEqual({ edit: { every: "; start\nM400\nG28" } });
    expect(parseRaw("x", "a\\\\nb")).toEqual({ edit: { every: "a\\nb" } });
    expect(parseRaw(PRESET.filament_retraction_length, '["nil","0.6"]')).toEqual({ edit: { each: ["nil", "0.6"] } });
    expect(parseRaw(PRESET.filament_retraction_length, "0.6")).toMatchObject({ error: expect.stringContaining("2 values") });
    expect(parseRaw(PRESET.filament_retraction_length, '["0.6"]')).toMatchObject({ error: expect.stringContaining("2 values") });
    expect(parseRaw(7, "8")).toMatchObject({ error: expect.any(String) });
  });

  it("keeps the keys that identify a preset out of reach", () => {
    for (const key of ["name", "filament_id", "inherits", "from", "filament_settings_id", "version"]) expect(lockedReason(key)).not.toBe("");
    expect(lockedReason("filament_start_gcode")).toBe("");
  });
});

describe("applyEdits", () => {
  it("sets every variant of a list, a string as a string, and adds a missing curated key", () => {
    const edits = new Map([
      ["nozzle_temperature", { every: "215" }],
      ["filament_retraction_length", { every: "0.8" }],
      ["filament_notes", { every: "Dry first" }],
      ["pressure_advance", { every: "0.03" }],
      ["empty_list", { every: "x" }],
    ]);
    const { preset, skipped } = applyEdits(PRESET, edits);
    expect(skipped).toEqual([]);
    expect(preset).toMatchObject({
      nozzle_temperature: ["215"],
      filament_retraction_length: ["0.8", "0.8"],
      filament_notes: "Dry first",
      pressure_advance: ["0.03"],
      empty_list: ["x"],
    });
    // Keys keep their order; a new one goes last.
    expect(Object.keys(preset)).toEqual([...Object.keys(PRESET), "pressure_advance"]);
    expect(PRESET.nozzle_temperature).toEqual(["220"]);
  });

  it("skips a list of values that doesn't fit the preset's number of variants", () => {
    const { preset, skipped } = applyEdits({ ...PRESET, filament_retraction_length: ["0.4"] }, new Map([["filament_retraction_length", { each: ["nil", "0.6"] }]]));
    expect(skipped).toEqual(["filament_retraction_length"]);
    expect(preset.filament_retraction_length).toEqual(["0.4"]);
  });

  it("lists what actually changes, with labels for curated fields and keys for the rest", () => {
    const edits = new Map([
      ["nozzle_temperature", { every: "215" }],
      ["nozzle_temperature_range_low", { every: "190" }],
      ["filament_start_gcode", { every: "G28" }],
    ]);
    expect(editChanges(PRESET, edits)).toEqual([
      { key: "nozzle_temperature", label: "Nozzle", from: "220 °C", to: "215 °C" },
      { key: "filament_start_gcode", label: "filament_start_gcode", from: "; start\\nM400", to: "G28" },
    ]);
  });

  it("refuses a nozzle range whose low end is above its high end", () => {
    expect(rangeError(applyEdits(PRESET, new Map([["nozzle_temperature_range_low", { every: "240" }]])).preset)).toBe(
      "Nozzle range: low (240 °C) is above high (230 °C)",
    );
    expect(rangeError(PRESET)).toBe("");
  });

  it("reads the nozzle range, when both ends are numbers", () => {
    expect(nozzleRange(PRESET)).toEqual({ low: 190, high: 230 });
    expect(nozzleRange({ nozzle_temperature_range_low: ["190"] })).toBeNull();
  });
});

describe("presetFamily", () => {
  const presets = [
    { name: "Red", filamentId: "PA000001", printer: "X1C 0.4", path: "/p/Red @X1C 0.4.json" },
    { name: "Red", filamentId: "PA000001", printer: "X1C 0.6", path: "/p/Red @X1C 0.6.json" },
    { name: "Blue", filamentId: "PB000002", printer: "X1C 0.4", path: "/p/Blue @X1C 0.4.json" },
    { name: "Rock", filamentId: "", printer: "X1", path: "/p/Rock @X1.json" },
    { name: "Rock", filamentId: "", printer: "X1C", path: "/p/Rock @X1C.json" },
  ];

  it("is the opened preset first, then the others with its filament ID", () => {
    expect(presetFamily(presets, presets[1]!).map((p) => p.path)).toEqual(["/p/Red @X1C 0.6.json", "/p/Red @X1C 0.4.json"]);
  });

  it("is only the opened preset when it has no filament ID to match on", () => {
    expect(presetFamily(presets, presets[3]!).map((p) => p.path)).toEqual(["/p/Rock @X1.json"]);
  });
});

describe("writePresetEdits", () => {
  let dir: string;
  const NOW = 1_800_000_000_000;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bambu-hando-edit-"));
  });

  async function preset(file: string, json: Record<string, unknown>): Promise<string> {
    const path = join(dir, file);
    await writeFile(path, `${JSON.stringify(json, null, 4)}\n`);
    return path;
  }

  it("writes each preset in BambuStudio's layout, changing only the edited keys, and dates its .info", async () => {
    const first = await preset("Red @A.json", { zeta: ["1"], nozzle_temperature: ["220"], alpha: ["2"] });
    const second = await preset("Red @B.json", { nozzle_temperature: ["230", "230"], zeta: ["1"] });
    await writeFile(join(dir, "Red @A.info"), "sync_info = \nsetting_id = PFUS0000\nupdated_time = 1700000000\n");

    const results = await writePresetEdits([first, second], new Map([["nozzle_temperature", { every: "215" }]]), NOW);

    expect(results).toEqual([
      { path: first, ok: true, detail: "" },
      { path: second, ok: true, detail: "" },
    ]);
    expect(await readFile(first, "utf-8")).toBe(`${JSON.stringify({ zeta: ["1"], nozzle_temperature: ["215"], alpha: ["2"] }, null, 4)}\n`);
    expect(await readFile(second, "utf-8")).toBe(`${JSON.stringify({ nozzle_temperature: ["215", "215"], zeta: ["1"] }, null, 4)}\n`);
    expect(await readFile(join(dir, "Red @A.info"), "utf-8")).toBe("sync_info = \nsetting_id = PFUS0000\nupdated_time = 1800000000\n");
  });

  it("leaves a preset that already has the values, says which edits didn't fit, and reports unreadable files", async () => {
    const same = await preset("Same @A.json", { nozzle_temperature: ["215"], filament_retraction_length: ["nil", "0.6"] });
    const narrow = await preset("Narrow @A.json", { nozzle_temperature: ["220"], filament_retraction_length: ["0.4"] });
    const without = await preset("Without @A.json", { nozzle_temperature: ["220"] });
    const broken = join(dir, "Broken @A.json");
    await writeFile(broken, "{");
    const before = await readFile(same, "utf-8");

    const edits = new Map([
      ["nozzle_temperature", { every: "215" }],
      ["filament_retraction_length", { each: ["nil", "0.6"] }],
    ]);
    const [kept, fitted, missing, failed] = await writePresetEdits([same, narrow, without, broken], edits, NOW);

    expect(kept).toEqual({ path: same, ok: true, detail: "it already had these values; left as it is" });
    expect(await readFile(same, "utf-8")).toBe(before);
    expect(fitted).toEqual({ path: narrow, ok: true, detail: "filament_retraction_length left as it is: it has 1 variant, not 2" });
    expect(JSON.parse(await readFile(narrow, "utf-8"))).toEqual({ nozzle_temperature: ["215"], filament_retraction_length: ["0.4"] });
    expect(missing).toEqual({ path: without, ok: true, detail: "filament_retraction_length left as it is: the preset doesn't have it" });
    expect(failed).toMatchObject({ path: broken, ok: false, detail: expect.stringContaining("couldn't read it") });
  });
});

describe("withNozzleRange", () => {
  it("changes the temperature range of the row with the code, keeping every other row and field", () => {
    const csv = "PA000001,Acme PLA Red,190,230,PLA\r\nPB000002,Acme PETG Blue,230,260,PETG";
    expect(withNozzleRange(csv, "PA000001", 200, 225)).toBe("PA000001,Acme PLA Red,200,225,PLA\r\nPB000002,Acme PETG Blue,230,260,PETG");
  });

  it("is null when no row has the code", () => {
    expect(withNozzleRange("PB000002,Acme PETG Blue,230,260,PETG", "PA000001", 200, 225)).toBeNull();
    expect(withNozzleRange("", "PA000001", 200, 225)).toBeNull();
  });
});
