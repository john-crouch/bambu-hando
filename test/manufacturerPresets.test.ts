// ABOUTME: Tests the manufacturer's preset from filament-db's export in the presets bambu-hando writes: precedence over
// ABOUTME: Generic, community values (3DFP, SpoolmanDB) only where no manufacturer value is, calibration on top.

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { PresetConfig } from "../src/bambuProfiles.js";
import { SystemProfiles } from "../src/bambuProfiles.js";
import { buildPreset, presetPath } from "../src/bambuStudio.js";
import { type FilamentDb, loadFilamentDb, manufacturerFor } from "../src/filamentDb.js";
import { filamentDetail, type TdfpSpool } from "../src/filamentProfiles.js";
import type { FilamentProfile } from "../src/models.js";
import { previewPlan } from "../src/planPreview.js";
import type { PresetSettings } from "../src/presetSettings.js";
import { runSync, type SyncEvent } from "../src/sync.js";
import { importProfile } from "../src/tdfpImport.js";
import { bambuConfigDir, installBambuStudio, SYSTEM_ASA_FIXTURE } from "./bambuStudioSetup.js";
import { FILAMENT_DB_FIXTURE } from "./filamentDbFixture.js";
import { serverFilament } from "./filamentProfilesServer.js";
import {
  type SpoolEaseServer,
  startSpoolEaseServer,
  TEST_SECURITY_KEY,
} from "./spooleaseServer.js";

const X1C_04 = "Bambu Lab X1 Carbon 0.4 nozzle";
const X1C_02 = "Bambu Lab X1 Carbon 0.2 nozzle";
const X1C_06 = "Bambu Lab X1 Carbon 0.6 nozzle";
const X1_04 = "Bambu Lab X1 0.4 nozzle";
const H2D_04 = "Bambu Lab H2D 0.4 nozzle";

/** A 3DFP spool of Polymaker ASA Black (3DFP filament 16899, filed under filament-db line 1383). */
function asaSpool(): TdfpSpool {
  return {
    shortCode: "asa1",
    filamentId: 16899,
    brand: "Polymaker",
    material: "ASA",
    materialType: null,
    color: "Black",
    rgb: "#000000",
    remainingGrams: 900,
    emptySpoolWeight: 140,
    location: null,
    notes: null,
    updatedAt: "2026-11-20T10:00:00.000Z",
    url: "https://spooldb.com/s/asa1",
    externalId: null,
    spoolProperties: { purchase_date: null, last_dried_date: null, bambu_tag_uid: null },
  };
}

/**
 * Community values for it, as 3DFP's record would give them: print 220 (200-240, below Polymaker's 230-260), bed 88
 * (85-91), flow 0.9, 20 mm³/s, K 0.05.
 */
const COMMUNITY = filamentDetail({
  ...serverFilament({
    id: 16899,
    brand_key: "polymaker",
    brand_name: "Polymaker",
    material_key: "asa",
    material: "ASA",
    color: "Black",
    rgb: "#000000",
    temp_min: 200,
    temp_max: 240,
    bed_temp_min: 85,
    bed_temp_max: 91,
    density: 1070,
    flow_ratio: 0.9,
    max_volumetric_speed: 20,
    k_value: 0.05,
  }),
});

const asaProfile = (calibration: PresetSettings = {}): FilamentProfile =>
  importProfile(asaSpool(), COMMUNITY, calibration);

describe("manufacturer presets in buildPreset", () => {
  let system: SystemProfiles;
  let db: FilamentDb;

  beforeAll(async () => {
    const home = await mkdtemp(join(tmpdir(), "bh-maker-"));
    await installBambuStudio(home, {}, SYSTEM_ASA_FIXTURE);
    system = await SystemProfiles.load(bambuConfigDir(home));
    const loaded = await loadFilamentDb(FILAMENT_DB_FIXTURE);
    if (!loaded.db) throw new Error("the fixture export didn't load");
    db = loaded.db;
  });

  function built(profile: FilamentProfile, printer: string): PresetConfig {
    const template = system.template(profile.material, printer);
    if (!template) throw new Error(`no template for ${printer}`);
    const maker = manufacturerFor(db, profile.sourceIds, system.printerModel(printer));
    return buildPreset(profile, printer, template, system.version, maker);
  }

  it("gives the H2D Polymaker's own H2D preset", () => {
    const preset = built(asaProfile(), H2D_04);
    expect(preset).toMatchObject({
      fan_min_speed: ["40"],
      fan_max_speed: ["90"],
      filament_flow_ratio: ["0.99", "nil"],
      nozzle_temperature: ["250", "nil"],
      nozzle_temperature_initial_layer: ["250", "nil"],
      filament_max_volumetric_speed: ["11", "nil"],
      filament_extruder_variant: ["Direct Drive Standard", "Direct Drive High Flow"],
      filament_density: ["1.13"],
      nozzle_temperature_range_low: ["230"],
      nozzle_temperature_range_high: ["260"],
      temperature_vitrification: ["105"],
    });
    // "not a BambuStudio setting": left out.
    expect(preset.idle_temperature).toBeUndefined();
  });

  it("keeps bambu-hando's own identity keys", () => {
    const profile = asaProfile();
    const preset = built(profile, H2D_04);
    expect(preset).toMatchObject({
      name: `Polymaker ASA Black @${H2D_04}`,
      inherits: "",
      from: "User",
      filament_id: profile.filamentId,
      filament_settings_id: [`Polymaker ASA Black @${H2D_04}`],
      filament_vendor: ["Polymaker"],
      compatible_printers: [H2D_04],
      version: system.version,
      default_filament_colour: ["#000000"],
      filament_diameter: ["1.75"],
    });
    expect(preset.filament_colour).toBeUndefined();
    expect(preset.filament_notes).toBe(
      "Generated by bambu-hando from BambuStudio's Generic ASA @BBL H2D preset with Polymaker's preset for the Bambu Lab H2D, 0.4 mm nozzle (filament-db: polymaker_preset).",
    );
  });

  it("gives the X1 Carbon 0.4 Polymaker's legacy preset", () => {
    expect(built(asaProfile(), X1C_04)).toMatchObject({
      fan_min_speed: ["5"],
      fan_max_speed: ["50"],
      close_fan_the_first_x_layers: ["2"],
      filament_flow_ratio: ["0.97"],
      filament_density: ["1.13"],
      nozzle_temperature_range_low: ["230"],
      nozzle_temperature_range_high: ["260"],
    });
  });

  it("gives the X1 the preset that fills in for it", () => {
    const x1 = built(asaProfile(), X1_04);
    const x1c = built(asaProfile(), X1C_04);
    for (const key of [
      "fan_min_speed",
      "fan_max_speed",
      "close_fan_the_first_x_layers",
      "filament_flow_ratio",
      "filament_density",
      "nozzle_temperature_range_low",
      "nozzle_temperature_range_high",
    ])
      expect(x1[key], key).toEqual(x1c[key]);
    expect(x1.fan_min_speed).toEqual(["5"]);
  });

  it("keeps the template's max volumetric speed on a 0.2 nozzle, where the export's is suspect", () => {
    const preset = built(asaProfile(), X1C_02);
    expect(preset.filament_max_volumetric_speed).toEqual(["2"]);
    expect(preset.fan_min_speed).toEqual(["5"]);
  });

  it("gives a nozzle without a preset the line's material settings only, community values where they're not", () => {
    const preset = built(asaProfile(), X1C_06);
    expect(preset).toMatchObject({
      filament_density: ["1.13"],
      nozzle_temperature_range_low: ["230"],
      nozzle_temperature_range_high: ["260"],
      temperature_vitrification: ["105"],
      filament_dev_ams_drying_temperature: ["65", "80", "65", "80"],
      // Generic's: no manufacturer value for these.
      fan_min_speed: ["10"],
      fan_max_speed: ["80"],
      // 3DFP's, which no manufacturer value covers here.
      filament_flow_ratio: ["0.9"],
      filament_max_volumetric_speed: ["20"],
      hot_plate_temp: ["88"],
      // 3DFP's 220, clamped into Polymaker's 230-260.
      nozzle_temperature: ["230"],
    });
  });

  it("doesn't let a community bed of 88 override the inherited 100", () => {
    const preset = built(asaProfile(), X1C_04);
    expect(preset.hot_plate_temp).toEqual(["100"]);
    expect(preset.textured_plate_temp).toEqual(["100"]);
    // Nor 3DFP's print temperature, flow, speed or K.
    expect(preset.nozzle_temperature).toEqual(["260"]);
    expect(preset.filament_max_volumetric_speed).toEqual(["12"]);
    expect(preset.pressure_advance).toEqual(["0.02"]);
  });

  it("puts the user's own calibration over everything", () => {
    const calibration = {
      printTemp: 255,
      bedTemp: 95,
      flowRatio: 0.93,
      pressureAdvance: { k: 0.03, enabled: true },
    };
    expect(built(asaProfile(calibration), X1C_04)).toMatchObject({
      nozzle_temperature: ["255"],
      nozzle_temperature_initial_layer: ["255"],
      hot_plate_temp: ["95"],
      filament_flow_ratio: ["0.93"],
      pressure_advance: ["0.03"],
      enable_pressure_advance: ["1"],
      fan_max_speed: ["50"],
    });
  });

  it("widens the manufacturer's range for a calibrated temperature outside it", () => {
    const preset = built(asaProfile({ printTemp: 265 }), X1C_04);
    expect(preset.nozzle_temperature).toEqual(["265"]);
    expect(preset.nozzle_temperature_range_low).toEqual(["230"]);
    expect(preset.nozzle_temperature_range_high).toEqual(["265"]);
  });

  it("finds a SpoolmanDB profile's line by its entry id", () => {
    const profile: FilamentProfile = {
      name: "Polymaker PolyLite™ ASA Black",
      brand: "Polymaker",
      material: "ASA",
      colorName: "PolyLite™ ASA Black",
      colorRgba: "000000FF",
      nozzleTempMin: 230,
      nozzleTempMax: 260,
      density: 1.07,
      diameter: 1.75,
      slicerFilamentCode: "",
      filamentId: "P0000001",
      labelWeight: 1000,
      coreWeight: 140,
      settings: { printTemp: 245, bedTemp: 90 },
      sourceIds: { spoolmanDb: "polymaker_asa_polyliteblack_1000_175_c" },
    };
    const preset = built(profile, X1C_04);
    expect(preset).toMatchObject({
      fan_min_speed: ["5"],
      fan_max_speed: ["50"],
      filament_density: ["1.13"],
      // Generic's, inherited by Polymaker's preset: SpoolmanDB doesn't override them.
      nozzle_temperature: ["260"],
      hot_plate_temp: ["100"],
    });
  });

  it("writes a filament without a line exactly as without the export", () => {
    const profile = { ...asaProfile(), sourceIds: { tdfp: 1 } };
    const template = system.template("ASA", X1C_04);
    if (!template) throw new Error("no template");
    expect(manufacturerFor(db, profile.sourceIds, system.printerModel(X1C_04))).toBeNull();
    expect(built(profile, X1C_04)).toEqual(buildPreset(profile, X1C_04, template, system.version));
  });
});

describe("manufacturer presets in a sync", () => {
  let server: SpoolEaseServer;
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "bh-maker-sync-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("FILAMENT_DB_EXPORT", FILAMENT_DB_FIXTURE);
    await installBambuStudio(home, {}, SYSTEM_ASA_FIXTURE);
    server = await startSpoolEaseServer();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await server.close();
  });

  const connection = () => ({
    host: "127.0.0.1",
    port: server.port,
    securityKey: TEST_SECURITY_KEY,
    https: false,
  });

  it("writes the manufacturer's preset and gives SpoolEase the manufacturer's range", async () => {
    const profile = asaProfile();
    // 3DFP's range is 200-240; Polymaker's is 230-260.
    expect([profile.nozzleTempMin, profile.nozzleTempMax]).toEqual([200, 240]);
    const { results } = await runSync({
      profiles: [profile],
      presetFolder: "default",
      printers: [X1C_04],
      dryRun: false,
      spoolease: connection(),
      createSpools: false,
    });
    expect(results[0]).toMatchObject({ bambuStatus: "written", spooleaseStatus: "written" });
    const written = JSON.parse(await readFile(presetPath(profile, "default", X1C_04), "utf-8"));
    expect(written).toMatchObject({ fan_min_speed: ["5"], filament_flow_ratio: ["0.97"] });
    const row = server.customFilaments
      ?.split("\n")
      .find((line) => line.startsWith(profile.filamentId));
    expect(row?.split(",").slice(2, 4)).toEqual(["230", "260"]);
  });

  it("previews the manufacturer's range", async () => {
    const [plan] = await previewPlan(
      [asaProfile()],
      { presetFolder: "default", printers: [X1C_04] },
      null,
      false,
    );
    expect(plan?.nozzleRange).toEqual({ low: 230, high: 260 });
  });

  it("warns about an export of another schema_version and writes presets as without it", async () => {
    const doc = JSON.parse(await readFile(FILAMENT_DB_FIXTURE, "utf-8"));
    const path = join(home, "catalog-v3.json");
    await writeFile(path, JSON.stringify({ ...doc, schema_version: 3 }), "utf-8");
    vi.stubEnv("FILAMENT_DB_EXPORT", path);
    const events: SyncEvent[] = [];
    const profile = asaProfile();
    await runSync(
      {
        profiles: [profile],
        presetFolder: "default",
        printers: [X1C_04],
        dryRun: false,
        spoolease: null,
        createSpools: false,
      },
      (event) => events.push(event),
    );
    expect(events).toContainEqual({
      type: "warning",
      message: `filament-db's export ${path} has schema_version 3, not 2: bambu-hando ignores it`,
    });
    const written = JSON.parse(await readFile(presetPath(profile, "default", X1C_04), "utf-8"));
    expect(written.fan_min_speed).toEqual(["10"]);
    expect(written.nozzle_temperature_range_low).toEqual(["200"]);
  });
});
