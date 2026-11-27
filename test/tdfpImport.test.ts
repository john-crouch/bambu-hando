// ABOUTME: Tests for bringing a 3DFilamentProfiles spool into BambuStudio and SpoolEase: the profile it becomes,
// ABOUTME: what refuses an import, and a full import against the stand-in servers (presets, CSV row, spool, link).

import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QuotaLedger } from "../src/apiQuota.js";
import {
  FilamentProfilesClient,
  type TdfpFilamentDetail,
  type TdfpSpool,
} from "../src/filamentProfiles.js";
import type { SpoolEaseConnection, SpoolRecord } from "../src/spoolease.js";
import { applyImport, hasCalibration, importProfile, prepareImport } from "../src/tdfpImport.js";
import { baseFilamentDir, installBambuStudio, X1C_04, X1C_06 } from "./bambuStudioSetup.js";
import {
  type FilamentProfilesServer,
  serverFilament,
  serverSpool,
  startFilamentProfilesServer,
  TEST_API_KEY,
} from "./filamentProfilesServer.js";
import {
  type SpoolEaseServer,
  startSpoolEaseServer,
  TEST_SECURITY_KEY,
} from "./spooleaseServer.js";

const NOW = new Date("2026-11-24T12:00:00Z");

function tdSpool(overrides: Partial<TdfpSpool> = {}): TdfpSpool {
  return {
    shortCode: "izDGMo7fU",
    filamentId: 10512,
    brand: "SUNLU",
    material: "PETG",
    materialType: "Elite",
    color: "Mildewed Red",
    rgb: "#AD0000",
    remainingGrams: 740,
    emptySpoolWeight: 180,
    location: "Shelf",
    notes: null,
    updatedAt: "2026-11-01T10:00:00.000Z",
    url: "https://spooldb.com/s/izDGMo7fU",
    externalId: null,
    spoolProperties: { purchase_date: null, last_dried_date: null, bambu_tag_uid: null },
    ...overrides,
  };
}

function record(overrides: Partial<TdfpFilamentDetail> = {}): TdfpFilamentDetail {
  return {
    id: 10512,
    brandKey: "sunlu",
    brandName: "SUNLU",
    materialKey: "petg",
    material: "PETG",
    materialTypeKey: "elite",
    materialType: "Elite",
    color: "Mildewed Red",
    rgb: "#AD0000",
    tdValue: null,
    discontinued: false,
    url: "https://3dfilamentprofiles.com/f/x",
    tempMin: 230,
    tempMax: 260,
    bedTempMin: 60,
    bedTempMax: 70,
    density: 1270,
    diameter: 1750,
    nominalWeight: 1000,
    spoolWeight: 190,
    chamberTemp: null,
    dryTempMax: 60,
    dryTime: 8,
    flowRatio: 0.95,
    kValue: 0.02,
    maxVolumetricSpeed: 11.5,
    softeningTemp: null,
    ...overrides,
  };
}

describe("importProfile", () => {
  it("makes the 3DFP spool's filament a profile, with 3DFP's values for its presets", () => {
    expect(importProfile(tdSpool(), record(), {})).toEqual({
      name: "SUNLU PETG Elite Mildewed Red",
      brand: "SUNLU",
      material: "PETG",
      colorName: "Elite Mildewed Red",
      colorRgba: "AD0000FF",
      nozzleTempMin: 230,
      nozzleTempMax: 260,
      density: 1.27,
      diameter: 1.75,
      slicerFilamentCode: "",
      filamentId: "Pf06dde9",
      labelWeight: 1000,
      // The spool's own empty weight wins over the filament's.
      coreWeight: 180,
      settings: {
        printTemp: 245,
        bedTemp: 65,
        flowRatio: 0.95,
        maxVolumetricSpeed: 11.5,
        pressureAdvance: { k: 0.02, enabled: false },
      },
      sourceIds: { tdfp: 10512 },
    });
  });

  it("keeps the spool's own calibration apart too, so it can go over a manufacturer's values", () => {
    const calibration = { printTemp: 250, pressureAdvance: { k: 0.031, enabled: true } };
    expect(importProfile(tdSpool(), record(), calibration).calibration).toEqual(calibration);
    expect(importProfile(tdSpool(), record(), {})).not.toHaveProperty("calibration");
  });

  it("puts the spool's own calibration first", () => {
    const profile = importProfile(tdSpool(), record(), {
      printTemp: 250,
      pressureAdvance: { k: 0.031, enabled: true },
    });
    expect(profile.settings).toMatchObject({
      printTemp: 250,
      bedTemp: 65,
      pressureAdvance: { k: 0.031, enabled: true },
    });
  });

  it("keeps names comma-free and falls back where the record has nothing", () => {
    const profile = importProfile(
      tdSpool({ color: "Red, Glossy", materialType: null, rgb: null, emptySpoolWeight: null }),
      record({
        tempMin: null,
        tempMax: null,
        density: null,
        diameter: null,
        nominalWeight: null,
        spoolWeight: null,
        bedTempMin: null,
        bedTempMax: null,
        flowRatio: null,
        kValue: null,
        maxVolumetricSpeed: null,
      }),
      {},
    );
    expect(profile).toMatchObject({
      name: "SUNLU PETG Red Glossy",
      colorName: "Red Glossy",
      nozzleTempMin: 190,
      nozzleTempMax: 240,
      density: 1.24,
      diameter: 1.75,
      labelWeight: 0,
      coreWeight: 0,
    });
    expect(profile).not.toHaveProperty("settings");
  });
});

describe("importProfile ranges", () => {
  it("widens the nozzle range to take the spool's own calibrated temperature", () => {
    const profile = importProfile(tdSpool(), record({ tempMin: 230, tempMax: 245 }), {
      printTemp: 250,
    });
    expect(profile).toMatchObject({
      nozzleTempMin: 230,
      nozzleTempMax: 250,
      settings: { printTemp: 250 },
    });
  });
});

describe("hasCalibration", () => {
  it("is true when spool_properties holds more than its dates and tag", () => {
    expect(hasCalibration(tdSpool())).toBe(false);
    expect(hasCalibration(tdSpool({ spoolProperties: null }))).toBe(false);
    expect(hasCalibration(tdSpool({ spoolProperties: { purchase_date: "2026-10-01" } }))).toBe(
      false,
    );
    expect(hasCalibration(tdSpool({ spoolProperties: { nozzle_temp: 250 } }))).toBe(true);
    expect(hasCalibration(tdSpool({ spoolProperties: { nozzle_temp: null } }))).toBe(false);
  });
});

describe("prepareImport", () => {
  const seSpool = (overrides: Partial<SpoolRecord> = {}): SpoolRecord => ({
    id: "3",
    tagId: "",
    material: "PETG",
    subtype: "",
    colorName: "Elite Mildewed Red",
    colorCodes: ["AD0000FF"],
    note: "",
    brand: "SUNLU",
    labelWeight: 1000,
    coreWeight: 180,
    fullWeight: null,
    currentWeight: null,
    consumedSinceWeighed: 0,
    slicerFilament: "Pf06dde9",
    addedTime: null,
    location: "",
    ...overrides,
  });
  const base = {
    record: async () => record(),
    calibration: async () => ({}),
  };

  it("refuses spools it can't or shouldn't bring in, and says what to do instead", async () => {
    const prepared = await prepareImport({
      ...base,
      codes: ["NOPE", "LINKED", "BAMBU", "izDGMo7fU"],
      tdfp: [
        tdSpool(),
        tdSpool({ shortCode: "LINKED" }),
        tdSpool({ shortCode: "BAMBU", brand: "Bambu Lab" }),
      ],
      links: [
        { spoolease: "9", tdfp: "LINKED", agreed: null, tag: null, linkedAt: NOW.toISOString() },
      ],
      spoolease: [seSpool()],
    });
    expect(prepared.items).toEqual([]);
    expect(prepared.refused).toEqual([
      { code: "NOPE", reason: "3DFilamentProfiles has no spool NOPE" },
      { code: "LINKED", reason: "already linked to SpoolEase spool #9" },
      {
        code: "BAMBU",
        reason:
          "a Bambu Lab filament: BambuStudio has its own presets for it, so add the spool on SpoolEase directly",
      },
      {
        code: "izDGMo7fU",
        reason:
          "SpoolEase spool #3 is already this filament (Pf06dde9): link it with `bambu-hando 3dfp sync --link 3=izDGMo7fU`",
      },
    ]);
  });

  it("reads no calibration for a spool it refuses, and refuses only the spool whose calibration fails", async () => {
    const calibration = vi.fn(async (code: string) => {
      if (code === "BROKEN") throw new Error("3DFilamentProfiles: no base preset (no_base_preset)");
      return {};
    });
    const calibrated = { spoolProperties: { nozzle_temp: 250 } };
    const prepared = await prepareImport({
      record: async () => record(),
      calibration,
      codes: ["TWINNED", "BROKEN", "FINE"],
      tdfp: [
        tdSpool({ shortCode: "TWINNED", ...calibrated }),
        tdSpool({ shortCode: "BROKEN", color: "Blue", ...calibrated }),
        tdSpool({ shortCode: "FINE", color: "Green" }),
      ],
      links: [],
      spoolease: [seSpool()],
    });
    expect(calibration).toHaveBeenCalledTimes(1);
    expect(prepared.items.map((item) => item.spool.shortCode)).toEqual(["FINE"]);
    expect(prepared.refused.map((r) => [r.code, r.reason])).toEqual([
      ["TWINNED", expect.stringContaining("SpoolEase spool #3 is already this filament")],
      [
        "BROKEN",
        "its own calibration couldn't be read: 3DFilamentProfiles: no base preset (no_base_preset)",
      ],
    ]);
  });

  it("reads each filament's record once, and a spool's calibration only when it has some", async () => {
    const records = vi.fn(async () => record());
    const calibration = vi.fn(async () => ({ printTemp: 250 }));
    const prepared = await prepareImport({
      record: records,
      calibration,
      codes: ["izDGMo7fU", "TWIN"],
      tdfp: [tdSpool(), tdSpool({ shortCode: "TWIN", spoolProperties: { nozzle_temp: 250 } })],
      links: [],
      spoolease: [],
    });
    expect(records).toHaveBeenCalledTimes(1);
    expect(calibration).toHaveBeenCalledTimes(1);
    expect(calibration).toHaveBeenCalledWith("TWIN");
    expect(
      prepared.items.map((item) => [item.spool.shortCode, item.profile.settings?.printTemp]),
    ).toEqual([
      ["izDGMo7fU", 245],
      ["TWIN", 250],
    ]);
    expect(prepared.refused).toEqual([]);
  });
});

describe("applyImport", () => {
  let tdfp: FilamentProfilesServer;
  let se: SpoolEaseServer;
  let home: string;
  let api: FilamentProfilesClient;
  let connection: SpoolEaseConnection;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "bh-import-"));
    vi.stubEnv("HOME", home);
    await installBambuStudio(home);
    tdfp = await startFilamentProfilesServer();
    se = await startSpoolEaseServer();
    tdfp.filaments = [serverFilament({ id: 10512 })];
    const mildewed = {
      filament_id: 10512,
      brand: "SUNLU",
      material: "PETG",
      material_type: "Elite",
      color: "Mildewed Red",
      rgb: "#AD0000",
      empty_spool_weight: 180,
    };
    tdfp.spools = [
      serverSpool({ ...mildewed, short_code: "izDGMo7fU" }),
      serverSpool({ ...mildewed, short_code: "TWIN" }),
    ];
    api = new FilamentProfilesClient({
      key: TEST_API_KEY,
      base: tdfp.url,
      ledger: new QuotaLedger(join(home, "quota.json"), "acct1"),
    });
    connection = { host: "127.0.0.1", port: se.port, securityKey: TEST_SECURITY_KEY, https: false };
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await tdfp.close();
    await se.close();
  });

  const prepared = async (codes: string[]) =>
    prepareImport({
      codes,
      tdfp: (await api.listSpools()).spools,
      links: [],
      spoolease: [],
      record: async () => record(),
      calibration: async () => ({}),
    });

  it("writes the presets and the CSV row once, a SpoolEase spool per 3DFP spool, and links them", async () => {
    const plan = await prepared(["izDGMo7fU", "TWIN"]);
    const result = await applyImport(plan, {
      sync: { presetFolder: "default", printers: [X1C_04, X1C_06], dryRun: false },
      connection,
      tdfp: api,
      now: NOW,
    });

    const files = await readdir(baseFilamentDir(home));
    expect(files.sort()).toEqual([
      `SUNLU PETG Elite Mildewed Red @${X1C_04}.json`,
      `SUNLU PETG Elite Mildewed Red @${X1C_06}.json`,
    ]);
    const preset = JSON.parse(await readFile(join(baseFilamentDir(home), files[0] ?? ""), "utf-8"));
    expect(preset).toMatchObject({
      filament_id: "Pf06dde9",
      nozzle_temperature: ["245"],
      hot_plate_temp: ["65"],
      filament_flow_ratio: ["0.95"],
      filament_max_volumetric_speed: ["11.5"],
      enable_pressure_advance: ["0"],
    });
    expect(se.customFilaments).toContain("Pf06dde9");
    expect(se.spools).toHaveLength(2);

    expect(result.outcomes.map((o) => [o.code, o.spoolId, o.error])).toEqual([
      ["izDGMo7fU", "1", null],
      ["TWIN", "2", null],
    ]);
    expect(result.links).toEqual([
      { spoolease: "1", tdfp: "izDGMo7fU", agreed: null, tag: null, linkedAt: NOW.toISOString() },
      { spoolease: "2", tdfp: "TWIN", agreed: null, tag: null, linkedAt: NOW.toISOString() },
    ]);
    // Both IDs in one bulk update.
    expect(tdfp.requests.filter((r) => r.method === "PATCH").map((r) => r.body)).toEqual([
      [
        { short_code: "izDGMo7fU", external_id: "spoolease:1" },
        { short_code: "TWIN", external_id: "spoolease:2" },
      ],
    ]);
    expect(result.calls).toBe(1);
  });

  it("links without writing over an external ID another app keeps", async () => {
    const first = tdfp.spools[0];
    if (first) first.external_id = "other-app:7";
    const plan = await prepared(["izDGMo7fU", "TWIN"]);
    const result = await applyImport(plan, {
      sync: { presetFolder: "default", printers: [X1C_04], dryRun: false },
      connection,
      tdfp: api,
      now: NOW,
    });
    expect(tdfp.requests.filter((r) => r.method === "PATCH").map((r) => r.body)).toEqual([
      [{ short_code: "TWIN", external_id: "spoolease:2" }],
    ]);
    expect(tdfp.spools[0]?.external_id).toBe("other-app:7");
    expect(result.links.map((link) => link.tdfp)).toEqual(["izDGMo7fU", "TWIN"]);
    expect(result.outcomes[0]?.warning).toBe(
      "its external ID on 3DFP is another app's (other-app:7), so the SpoolEase ID wasn't written there",
    );
  });

  it("reports a SpoolEase reply without a spool ID as a failure, and links nothing", async () => {
    se.replies["POST /api/spools/add-edit"] = { status: 200, body: "{}" };
    const plan = await prepared(["izDGMo7fU"]);
    const result = await applyImport(plan, {
      sync: { presetFolder: "default", printers: [X1C_04], dryRun: false },
      connection,
      tdfp: api,
      now: NOW,
    });
    expect(result.outcomes[0]).toMatchObject({
      spoolId: null,
      error: expect.stringMatching(/no spool ID/),
    });
    expect(result.links).toEqual([]);
    expect(tdfp.requests.filter((r) => r.method === "PATCH")).toEqual([]);
  });

  it("changes nothing on a dry run", async () => {
    const plan = await prepared(["izDGMo7fU"]);
    const before = tdfp.requests.length;
    const result = await applyImport(plan, {
      sync: { presetFolder: "default", printers: [X1C_04], dryRun: true },
      connection,
      tdfp: api,
      now: NOW,
    });
    await expect(readdir(baseFilamentDir(home))).rejects.toThrow();
    expect(se.spools).toHaveLength(0);
    expect(tdfp.requests).toHaveLength(before);
    expect(result.outcomes).toMatchObject([{ code: "izDGMo7fU", spoolId: null, error: null }]);
    expect(result.links).toEqual([]);
  });

  it("adds no spool when the CSV row couldn't be written, since spools need it", async () => {
    se.replies["POST /api/filaments-config"] = { status: 500, body: "nope" };
    const plan = await prepared(["izDGMo7fU"]);
    const result = await applyImport(plan, {
      sync: { presetFolder: "default", printers: [X1C_04], dryRun: false },
      connection,
      tdfp: api,
      now: NOW,
    });
    expect(se.spools).toHaveLength(0);
    expect(result.outcomes[0]?.error).toMatch(/custom filament/i);
    expect(result.links).toEqual([]);
  });
});
