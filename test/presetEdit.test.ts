// ABOUTME: Tests for editing BambuStudio filament presets: curated fields, raw settings, sibling presets and writing.
// ABOUTME: Writes real preset and .info files in a temporary folder and reads them back.

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";
import type { FilamentProfile } from "../src/models.js";
import {
  activeVariant,
  applyEdits,
  EDIT_FIELDS,
  editChanges,
  editField,
  fieldText,
  lockedReason,
  nozzleRange,
  nozzleSpecific,
  parseField,
  parseRaw,
  presetFamily,
  rangeError,
  rawText,
  readPreset,
  shownValue,
  syncedRange,
  variantNames,
  writePresetEdits,
  writePresetTargets,
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
    expect(keys).toEqual(
      expect.arrayContaining([
        "nozzle_temperature",
        "textured_plate_temp",
        "filament_flow_ratio",
        "pressure_advance",
        "fan_max_speed",
        "filament_density",
        "filament_notes",
      ]),
    );
    expect(editField("filament_start_gcode")).toBeUndefined();
  });

  it("shows a value with its unit, per variant when they differ, and names the special values", () => {
    expect(shownValue(field("nozzle_temperature"), PRESET.nozzle_temperature)).toBe("220 °C");
    expect(shownValue(field("filament_retraction_length"), PRESET.filament_retraction_length)).toBe(
      "printer's / 0.4 mm",
    );
    expect(shownValue(field("filament_retraction_speed"), PRESET.filament_retraction_speed)).toBe(
      "printer's",
    );
    expect(shownValue(field("enable_pressure_advance"), ["0"])).toBe("off");
    expect(shownValue(field("enable_pressure_advance"), ["1"])).toBe("on");
    expect(shownValue(field("default_filament_colour"), [""])).toBe("none");
    expect(shownValue(field("default_filament_colour"), ["#ad0000"])).toBe("#AD0000");
    expect(shownValue(field("filament_notes"), "")).toBe("none");
    expect(shownValue(field("filament_notes"), "Dry first\nthen print")).toBe(
      "Dry first\\nthen print",
    );
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
    expect(parseField(field("nozzle_temperature"), "215.5")).toEqual({
      error: "Nozzle: type a whole number from 0 to 500",
    });
    expect(parseField(field("nozzle_temperature"), "")).toEqual({
      error: "Nozzle: type a whole number from 0 to 500",
    });
    expect(parseField(field("filament_flow_ratio"), "0.98")).toEqual({ value: "0.98" });
    expect(parseField(field("filament_flow_ratio"), ".98")).toEqual({ value: "0.98" });
    expect(parseField(field("filament_flow_ratio"), "3")).toMatchObject({
      error: expect.stringContaining("Flow ratio"),
    });
    expect(parseField(field("fan_max_speed"), "101")).toMatchObject({
      error: expect.stringContaining("0 to 100"),
    });
  });

  it("turns nothing typed into the printer's value where a field has one", () => {
    expect(parseField(field("filament_retraction_length"), "")).toEqual({ value: "nil" });
    expect(parseField(field("filament_retraction_length"), "0.8")).toEqual({ value: "0.8" });
  });

  it("takes a color as 6 hex digits, or nothing for none, and notes as any text", () => {
    expect(parseField(field("default_filament_colour"), "ad0000")).toEqual({ value: "#AD0000" });
    expect(parseField(field("default_filament_colour"), "#AD0000")).toEqual({ value: "#AD0000" });
    expect(parseField(field("default_filament_colour"), "")).toEqual({ value: "" });
    expect(parseField(field("default_filament_colour"), "red")).toMatchObject({
      error: expect.stringContaining("6 hex digits"),
    });
    expect(parseField(field("filament_notes"), "Dry 8 h\\nat 55 °C")).toEqual({
      value: "Dry 8 h\nat 55 °C",
    });
  });
});

describe("raw settings", () => {
  it("shows strings and lists of one value as text, with newlines as \\n, and lists that differ as JSON", () => {
    expect(rawText(PRESET.filament_start_gcode)).toBe("; start\\nM400");
    expect(rawText("a\\b")).toBe("a\\\\b");
    expect(rawText(PRESET.filament_retraction_speed)).toBe("nil");
    expect(rawText(PRESET.filament_extruder_variant)).toBe(
      '["Direct Drive Standard","Direct Drive High Flow"]',
    );
    expect(rawText(PRESET.empty_list)).toBe("");
    expect(rawText(7)).toBeNull();
  });

  it("reads text back the way it was shown", () => {
    expect(parseRaw(PRESET.filament_start_gcode, "; start\\nM400\\nG28")).toEqual({
      edit: { every: "; start\nM400\nG28" },
    });
    expect(parseRaw("x", "a\\\\nb")).toEqual({ edit: { every: "a\\nb" } });
    expect(parseRaw(PRESET.filament_retraction_length, '["nil","0.6"]')).toEqual({
      edit: { each: ["nil", "0.6"] },
    });
    expect(parseRaw(PRESET.filament_retraction_length, "0.6")).toMatchObject({
      error: expect.stringContaining("2 values"),
    });
    expect(parseRaw(PRESET.filament_retraction_length, '["0.6"]')).toMatchObject({
      error: expect.stringContaining("2 values"),
    });
    expect(parseRaw(7, "8")).toMatchObject({ error: expect.any(String) });
  });

  it("keeps the keys that identify a preset out of reach", () => {
    for (const key of [
      "name",
      "filament_id",
      "inherits",
      "from",
      "filament_settings_id",
      "version",
    ])
      expect(lockedReason(key)).not.toBe("");
    expect(lockedReason("filament_start_gcode")).toBe("");
  });
});

describe("applyEdits", () => {
  it("sets every variant of a list but its printer's ones, a string as a string, and adds a missing curated key", () => {
    const edits = new Map([
      ["nozzle_temperature", { every: "215" }],
      ["filament_retraction_length", { every: "0.8" }],
      ["filament_retraction_speed", { every: "30" }],
      ["filament_notes", { every: "Dry first" }],
      ["pressure_advance", { every: "0.03" }],
      ["empty_list", { every: "x" }],
    ]);
    const { preset, skipped } = applyEdits(PRESET, edits);
    expect(skipped).toEqual([]);
    expect(preset).toMatchObject({
      nozzle_temperature: ["215"],
      // "nil" is the printer's value, kept as buildPreset's everyVariant keeps it.
      filament_retraction_length: ["nil", "0.8"],
      // Only the printer's: the value goes everywhere, or it couldn't be set at all.
      filament_retraction_speed: ["30", "30"],
      filament_notes: "Dry first",
      pressure_advance: ["0.03"],
      empty_list: ["x"],
    });
    // Keys keep their order; a new one goes last.
    expect(Object.keys(preset)).toEqual([...Object.keys(PRESET), "pressure_advance"]);
    expect(PRESET.nozzle_temperature).toEqual(["220"]);
  });

  it("skips a list of values that doesn't fit the preset's number of variants", () => {
    const { preset, skipped } = applyEdits(
      { ...PRESET, filament_retraction_length: ["0.4"] },
      new Map([["filament_retraction_length", { each: ["nil", "0.6"] }]]),
    );
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
      {
        key: "filament_start_gcode",
        label: "filament_start_gcode",
        from: "; start\\nM400",
        to: "G28",
      },
    ]);
  });

  it("refuses a nozzle range whose low end is above its high end", () => {
    expect(
      rangeError(
        applyEdits(PRESET, new Map([["nozzle_temperature_range_low", { every: "240" }]])).preset,
      ),
    ).toBe("Nozzle range: low (240 °C) is above high (230 °C)");
    expect(rangeError(PRESET)).toBe("");
  });

  it("reads the nozzle range, when both ends are numbers", () => {
    expect(nozzleRange(PRESET)).toEqual({ low: 190, high: 230 });
    expect(nozzleRange({ nozzle_temperature_range_low: ["190"] })).toBeNull();
  });
});

describe("nozzle types (filament_extruder_variant)", () => {
  const TWO = ["Direct Drive Standard", "Direct Drive High Flow"];
  const flow = (speeds: string[], names: string[] | null = TWO) => ({
    ...(names ? { filament_extruder_variant: names } : {}),
    filament_max_volumetric_speed: speeds,
  });
  const edit = (preset: Record<string, unknown>, variant: string, value: string) =>
    applyEdits(preset, new Map([["filament_max_volumetric_speed", { variant, value }]]));

  it("names a preset's variants, BambuStudio's default when it lists none", () => {
    expect(variantNames(flow(["22", "29"]))).toEqual(TWO);
    expect(variantNames({})).toEqual(["Direct Drive Standard"]);
  });

  it("finds the variant BambuStudio uses for the printer's nozzle type, else the first", () => {
    expect(activeVariant(flow(["22", "29"]), "Standard")).toBe(0);
    expect(activeVariant(flow(["22", "29"]), "High Flow")).toBe(1);
    expect(activeVariant(flow(["22", "29"], [...TWO].reverse()), "Standard")).toBe(1);
    // Not in the preset, or unknown: BambuStudio falls back to the first.
    expect(activeVariant(flow(["22"], ["Direct Drive Standard"]), "High Flow")).toBe(0);
    expect(activeVariant(flow(["22", "29"]), "")).toBe(0);
    // Another extruder type: the nozzle type still picks it, Direct Drive first when both are there.
    expect(
      activeVariant(flow(["1", "2"], ["Bowden Standard", "Bowden High Flow"]), "High Flow"),
    ).toBe(1);
    expect(
      activeVariant(flow(["1", "2"], ["Bowden High Flow", "Direct Drive High Flow"]), "High Flow"),
    ).toBe(1);
    // Only "<extruder type> <nozzle type>" exactly: a longer name that ends the same is another variant.
    expect(
      activeVariant(
        flow(["1", "2"], ["Direct Drive Standard", "Direct Drive TPU High Flow"]),
        "High Flow",
      ),
    ).toBe(0);
    expect(
      activeVariant(flow(["1", "2"], ["Direct Drive Standard", "Other High Flow"]), "High Flow"),
    ).toBe(0);
  });

  it("writes the named variant and those that held its value, never one set apart", () => {
    expect(edit(flow(["22", "29"]), "Direct Drive Standard", "24").preset).toMatchObject(
      flow(["24", "29"]),
    );
    expect(edit(flow(["22", "29"]), "Direct Drive High Flow", "30").preset).toMatchObject(
      flow(["22", "30"]),
    );
    expect(edit(flow(["22", "22"]), "Direct Drive Standard", "24").preset).toMatchObject(
      flow(["24", "24"]),
    );
    // Per file: another preset's variants are judged by their own values.
    expect(
      edit(flow(["22", "29"], [...TWO].reverse()), "Direct Drive Standard", "24").preset,
    ).toMatchObject(flow(["22", "24"], [...TWO].reverse()));
  });

  it("keeps the printer's own value (nil) unless the named variant holds it", () => {
    const retraction = (values: string[]) => ({
      filament_extruder_variant: TWO,
      filament_retraction_length: values,
    });
    const set = (preset: Record<string, unknown>, variant: string) =>
      applyEdits(preset, new Map([["filament_retraction_length", { variant, value: "1" }]])).preset;
    expect(set(retraction(["nil", "0.4"]), "Direct Drive High Flow")).toMatchObject(
      retraction(["nil", "1"]),
    );
    expect(set(retraction(["nil", "0.4"]), "Direct Drive Standard")).toMatchObject(
      retraction(["1", "0.4"]),
    );
    expect(set(retraction(["nil", "nil"]), "Direct Drive Standard")).toMatchObject(
      retraction(["1", "1"]),
    );
  });

  it("writes the first variant of a preset without the named one, as BambuStudio would use it", () => {
    const one = flow(["22"], ["Direct Drive Standard"]);
    expect(edit(one, "Direct Drive High Flow", "30").preset).toMatchObject(
      flow(["30"], ["Direct Drive Standard"]),
    );
    expect(edit(flow(["22", "29"], null), "Direct Drive High Flow", "30").preset).toMatchObject(
      flow(["30", "29"], null),
    );
    // A string, or a key the preset lacks, takes the value as an every-variant edit would.
    expect(
      applyEdits(
        {},
        new Map([
          ["filament_notes", { variant: "Direct Drive Standard", value: "Dry" }],
          ["nozzle_temperature", { variant: "Direct Drive Standard", value: "220" }],
        ]),
      ).preset,
    ).toEqual({ filament_notes: "Dry", nozzle_temperature: ["220"] });
  });

  it("starts a field's text from the variant asked for", () => {
    expect(fieldText(field("filament_max_volumetric_speed"), ["22", "29"], 1)).toBe("29");
    expect(fieldText(field("filament_retraction_length"), ["nil", "0.4"], 0)).toBe("");
    expect(fieldText(field("filament_max_volumetric_speed"), ["22"], 1)).toBe("22");
  });
});

describe("nozzleSpecific", () => {
  it("names the settings that depend on the nozzle size: flow speed, pressure advance, retraction, and raw keys", () => {
    for (const key of [
      "filament_max_volumetric_speed",
      "enable_pressure_advance",
      "pressure_advance",
      "filament_retraction_length",
      "filament_retraction_speed",
      "filament_start_gcode",
    ])
      expect(nozzleSpecific(key), key).toBe(true);
    for (const key of [
      "nozzle_temperature",
      "nozzle_temperature_range_low",
      "hot_plate_temp",
      "filament_flow_ratio",
      "fan_max_speed",
      "default_filament_colour",
      "filament_density",
      "filament_cost",
      "filament_notes",
    ])
      expect(nozzleSpecific(key), key).toBe(false);
  });
});

describe("syncedRange", () => {
  const profile = { nozzleTempMin: 200, nozzleTempMax: 220 } as FilamentProfile;
  const range = (low: string, high: string) => ({
    nozzle_temperature_range_low: [low],
    nozzle_temperature_range_high: [high],
  });

  it("is the profile's range when every preset is written as built", () => {
    expect(syncedRange(profile, [])).toEqual({ low: 200, high: 220 });
  });

  it("takes the edits' range, as the written presets get it", () => {
    const edits = new Map([["nozzle_temperature_range_high", { every: "235" }]]);
    expect(syncedRange(profile, [], edits)).toEqual({ low: 200, high: 235 });
  });

  it("prefers a kept preset's range over the profile and the edits, which don't reach it", () => {
    const edits = new Map([["nozzle_temperature_range_high", { every: "235" }]]);
    expect(syncedRange(profile, [range("230", "255")], edits)).toEqual({ low: 230, high: 255 });
  });

  it("goes past kept presets without a range", () => {
    expect(syncedRange(profile, [{}, range("210", "240")])).toEqual({ low: 210, high: 240 });
    expect(syncedRange(profile, [{}])).toEqual({ low: 200, high: 220 });
  });
});

describe("readPreset", () => {
  it("reads a preset file, and is null for one that's missing or isn't a preset", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bambu-hando-read-"));
    await writeFile(join(dir, "ok.json"), '{"name": "Red"}');
    await writeFile(join(dir, "list.json"), "[1]");
    await writeFile(join(dir, "bad.json"), "{");

    expect(await readPreset(join(dir, "ok.json"))).toEqual({ name: "Red" });
    expect(await readPreset(join(dir, "list.json"))).toBeNull();
    expect(await readPreset(join(dir, "bad.json"))).toBeNull();
    expect(await readPreset(join(dir, "missing.json"))).toBeNull();
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
    expect(presetFamily(presets, presets[1]!).map((p) => p.path)).toEqual([
      "/p/Red @X1C 0.6.json",
      "/p/Red @X1C 0.4.json",
    ]);
  });

  it("is only the opened preset when it has no filament ID to match on", () => {
    expect(presetFamily(presets, presets[3]!).map((p) => p.path)).toEqual(["/p/Rock @X1.json"]);
  });
});

describe("writePresetTargets", () => {
  it("writes each preset only its own edits", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bambu-hando-targets-"));
    const write = async (file: string) => {
      const path = join(dir, file);
      await writeFile(
        path,
        `${JSON.stringify({ nozzle_temperature: ["220"], filament_max_volumetric_speed: ["22"] }, null, 4)}\n`,
      );
      return path;
    };
    const a = await write("Red @A.json");
    const b = await write("Red @B.json");
    const results = await writePresetTargets(
      [
        {
          path: a,
          edits: new Map([
            ["nozzle_temperature", { every: "230" }],
            ["filament_max_volumetric_speed", { every: "24" }],
          ]),
        },
        { path: b, edits: new Map([["nozzle_temperature", { every: "230" }]]) },
      ],
      1_800_000_000_000,
    );
    expect(results.map((r) => r.ok)).toEqual([true, true]);
    expect(JSON.parse(await readFile(a, "utf-8"))).toEqual({
      nozzle_temperature: ["230"],
      filament_max_volumetric_speed: ["24"],
    });
    expect(JSON.parse(await readFile(b, "utf-8"))).toEqual({
      nozzle_temperature: ["230"],
      filament_max_volumetric_speed: ["22"],
    });
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
    const first = await preset("Red @A.json", {
      zeta: ["1"],
      nozzle_temperature: ["220"],
      alpha: ["2"],
    });
    const second = await preset("Red @B.json", { nozzle_temperature: ["230", "230"], zeta: ["1"] });
    await writeFile(
      join(dir, "Red @A.info"),
      "sync_info = \nsetting_id = PFUS0000\nupdated_time = 1700000000\n",
    );

    const results = await writePresetEdits(
      [first, second],
      new Map([["nozzle_temperature", { every: "215" }]]),
      NOW,
    );

    expect(results).toEqual([
      { path: first, ok: true, detail: "" },
      { path: second, ok: true, detail: "" },
    ]);
    expect(await readFile(first, "utf-8")).toBe(
      `${JSON.stringify({ zeta: ["1"], nozzle_temperature: ["215"], alpha: ["2"] }, null, 4)}\n`,
    );
    expect(await readFile(second, "utf-8")).toBe(
      `${JSON.stringify({ nozzle_temperature: ["215", "215"], zeta: ["1"] }, null, 4)}\n`,
    );
    expect(await readFile(join(dir, "Red @A.info"), "utf-8")).toBe(
      "sync_info = \nsetting_id = PFUS0000\nupdated_time = 1800000000\n",
    );
  });

  it("leaves a preset that already has the values, says which edits didn't fit, and reports unreadable files", async () => {
    const same = await preset("Same @A.json", {
      nozzle_temperature: ["215"],
      filament_retraction_length: ["nil", "0.6"],
    });
    const narrow = await preset("Narrow @A.json", {
      nozzle_temperature: ["220"],
      filament_retraction_length: ["0.4"],
    });
    const without = await preset("Without @A.json", { nozzle_temperature: ["220"] });
    const broken = join(dir, "Broken @A.json");
    await writeFile(broken, "{");
    const before = await readFile(same, "utf-8");

    const edits = new Map([
      ["nozzle_temperature", { every: "215" }],
      ["filament_retraction_length", { each: ["nil", "0.6"] }],
    ]);
    const [kept, fitted, missing, failed] = await writePresetEdits(
      [same, narrow, without, broken],
      edits,
      NOW,
    );

    expect(kept).toEqual({
      path: same,
      ok: true,
      detail: "it already had these values; left as it is",
    });
    expect(await readFile(same, "utf-8")).toBe(before);
    expect(fitted).toEqual({
      path: narrow,
      ok: true,
      detail: "filament_retraction_length left as it is: it has 1 variant, not 2",
    });
    expect(JSON.parse(await readFile(narrow, "utf-8"))).toEqual({
      nozzle_temperature: ["215"],
      filament_retraction_length: ["0.4"],
    });
    expect(missing).toEqual({
      path: without,
      ok: true,
      detail: "filament_retraction_length left as it is: the preset doesn't have it",
    });
    expect(failed).toMatchObject({
      path: broken,
      ok: false,
      detail: expect.stringContaining("couldn't read it"),
    });
  });
});

describe("withNozzleRange", () => {
  it("changes the temperature range of the row with the code, keeping every other row and field", () => {
    const csv = "PA000001,Acme PLA Red,190,230,PLA\r\nPB000002,Acme PETG Blue,230,260,PETG";
    expect(withNozzleRange(csv, "PA000001", 200, 225)).toBe(
      "PA000001,Acme PLA Red,200,225,PLA\r\nPB000002,Acme PETG Blue,230,260,PETG",
    );
  });

  it("is null when no row has the code", () => {
    expect(
      withNozzleRange("PB000002,Acme PETG Blue,230,260,PETG", "PA000001", 200, 225),
    ).toBeNull();
    expect(withNozzleRange("", "PA000001", 200, 225)).toBeNull();
  });
});
