// ABOUTME: Tests for what `3dfp import` and the TUI share: the basis an import reads, the local-catalog preview (no API
// ABOUTME: call), the preparation (catalog first, then the API, calls counted) and saving the new links beside others.

import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FilamentCatalog } from "../src/filamentCatalog.js";
import { spoolsCachePath } from "../src/filamentProfilesCache.js";
import type { FilamentProfilesConnection } from "../src/filamentProfilesConnect.js";
import { connectFilamentProfiles } from "../src/filamentProfilesConnect.js";
import { configDir } from "../src/paths.js";
import type { SpoolEaseConnection, SpoolRecord } from "../src/spoolease.js";
import { linksPath, saveLinks } from "../src/spoolLinks.js";
import { KeyCheckError } from "../src/sync.js";
import type { AppliedImport } from "../src/tdfpImport.js";
import {
  importSettingsText,
  prepareFromApi,
  previewImport,
  readImportBasis,
  saveImportLinks,
} from "../src/tdfpImportSession.js";
import { installBambuStudio } from "./bambuStudioSetup.js";
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

describe("tdfpImportSession", () => {
  let tdfp: FilamentProfilesServer;
  let spoolease: SpoolEaseServer;
  let home: string;
  let api: FilamentProfilesConnection;
  let target: SpoolEaseConnection;

  beforeEach(async () => {
    tdfp = await startFilamentProfilesServer();
    tdfp.quota.remaining = 900;
    tdfp.filaments = [
      serverFilament({ id: 10512, material_type: "Elite", color: "Mildewed Red", rgb: "#AD0000" }),
      serverFilament({ id: 20, brand_name: "Acme", color: "Blue", rgb: "#0000FF" }),
    ];
    tdfp.spools = [
      serverSpool({
        short_code: "izDGMo7fU",
        filament_id: 10512,
        brand: "SUNLU",
        material_type: "Elite",
        color: "Mildewed Red",
        rgb: "#AD0000",
      }),
      serverSpool({ short_code: "bambu1", filament_id: 30, brand: "Bambu Lab", color: "Red" }),
      serverSpool({ short_code: "acme1", filament_id: 20, brand: "Acme", color: "Blue" }),
      serverSpool({ short_code: "linked1", filament_id: 20, brand: "Acme", color: "Blue" }),
    ];
    spoolease = await startSpoolEaseServer();
    home = await mkdtemp(join(tmpdir(), "bh-3dfp-session-"));
    await installBambuStudio(home);
    vi.stubEnv("HOME", home);
    vi.stubEnv("XDG_CONFIG_HOME", undefined);
    vi.stubEnv("XDG_CACHE_HOME", undefined);
    vi.stubEnv("XDG_DATA_HOME", undefined);
    vi.stubEnv("FILAMENTPROFILES_API_KEY", TEST_API_KEY);
    vi.stubEnv("FILAMENTPROFILES_API_URL", tdfp.url);
    api = await connectFilamentProfiles();
    target = {
      host: "127.0.0.1",
      port: spoolease.port,
      securityKey: TEST_SECURITY_KEY,
      https: false,
    };
    await saveLinks(linksPath(), api.account, target.host, [
      { spoolease: "9", tdfp: "linked1", agreed: null, tag: null, linkedAt: NOW.toISOString() },
    ]);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await tdfp.close();
    await spoolease.close();
  });

  const apiCalls = () => tdfp.requests.length;

  it("reads the 3DFP spools, this console's links and SpoolEase's spools", async () => {
    const basis = await readImportBasis(api, target);
    expect(basis.tdfp.map((s) => s.shortCode)).toEqual(["izDGMo7fU", "bambu1", "acme1", "linked1"]);
    expect(basis.fromCache).toBe(false);
    expect(basis.links.map((l) => l.tdfp)).toEqual(["linked1"]);
    expect(basis.linkWarning).toBeNull();
    expect(basis.spoolease).toEqual([]);
    // Within the hour the list comes from the cache: no call.
    const again = await readImportBasis(api, target);
    expect(again.fromCache).toBe(true);
    expect(apiCalls()).toBe(1);
  });

  it("refuses a console that rejects the key before reading 3DFP", async () => {
    await expect(readImportBasis(api, { ...target, securityKey: "wrong" })).rejects.toThrow(
      KeyCheckError,
    );
    expect(apiCalls()).toBe(0);
  });

  it("previews from the local catalog only: linked spools left out, refusals said, unknown records open", async () => {
    const basis = await readImportBasis(api, target);
    const catalog = FilamentCatalog.open(join(home, "catalog.sqlite"));
    try {
      const { getFilament } = api.client;
      catalog.saveRecord(10512, await getFilament.call(api.client, 10512), NOW);
      const before = apiCalls();
      const preview = await previewImport(basis, catalog, NOW);
      expect(apiCalls()).toBe(before);
      expect(preview.linked).toBe(1);
      expect(
        preview.rows.map((row) => ({
          code: row.spool.shortCode,
          id: row.item?.profile.filamentId ?? null,
          refused: row.refusal !== null,
        })),
      ).toEqual([
        { code: "izDGMo7fU", id: "Pf06dde9", refused: false },
        { code: "bambu1", id: null, refused: true },
        // Its record isn't in the catalog: read on review.
        { code: "acme1", id: null, refused: false },
      ]);
      expect(preview.rows[1]?.refusal).toMatch(/Bambu Lab/);
    } finally {
      catalog.close();
    }
  });

  it("says a SpoolEase spool of the same filament that no link claims is already there", async () => {
    const basis = await readImportBasis(api, target);
    const catalog = FilamentCatalog.open(join(home, "catalog.sqlite"));
    try {
      catalog.saveRecord(10512, await api.client.getFilament(10512), NOW);
      const twin = {
        ...basis,
        spoolease: [{ ...spooleaseSpool("4"), slicerFilament: "Pf06dde9" }],
      };
      const preview = await previewImport(twin, catalog, NOW);
      expect(preview.rows[0]?.refusal).toMatch(/SpoolEase spool #4 is already this filament/);
    } finally {
      catalog.close();
    }
  });

  it("prepares from the catalog first, then the API, and counts the calls", async () => {
    const basis = await readImportBasis(api, target);
    const path = join(home, "catalog.sqlite");
    const catalog = FilamentCatalog.open(path);
    catalog.saveRecord(10512, await api.client.getFilament(10512), NOW);
    catalog.close();
    const before = apiCalls();
    const { prepared, calls, warnings } = await prepareFromApi(
      api,
      basis,
      ["izDGMo7fU", "acme1", "bambu1"],
      { catalogPath: path },
    );
    expect(prepared.items.map((i) => i.spool.shortCode)).toEqual(["izDGMo7fU", "acme1"]);
    expect(prepared.refused.map((r) => r.code)).toEqual(["bambu1"]);
    // acme1's record is fetched once; izDGMo7fU's came from the catalog.
    expect(calls).toBe(1);
    expect(apiCalls() - before).toBe(1);
    expect(warnings).toEqual([]);
  });

  it("reads a spool's own calibration only when it has some", async () => {
    tdfp.spools = [
      serverSpool({
        short_code: "cal1",
        filament_id: 20,
        brand: "Acme",
        color: "Blue",
        spool_properties: { nozzle_temp: 215 },
      }),
    ];
    const basis = await readImportBasis(api, target);
    const { prepared, calls } = await prepareFromApi(api, basis, ["cal1"], {
      catalogPath: join(home, "catalog.sqlite"),
    });
    expect(prepared.items[0]?.calibrated).toBe(true);
    // The record and the calibration.
    expect(calls).toBe(2);
  });

  it("saves the new links beside the ones saved meanwhile, and forgets the cached spool list", async () => {
    const basis = await readImportBasis(api, target);
    // Another sync linked a spool after the basis was read.
    await saveLinks(linksPath(), api.account, target.host, [
      ...basis.links,
      { spoolease: "10", tdfp: "other", agreed: null, tag: null, linkedAt: NOW.toISOString() },
    ]);
    const applied = {
      links: [
        { spoolease: "11", tdfp: "acme1", agreed: null, tag: null, linkedAt: NOW.toISOString() },
      ],
      calls: 1,
    } as unknown as AppliedImport;
    expect(await saveImportLinks(api, target.host, applied)).toBeNull();
    const file = join(configDir(process.platform, home, {}), "3dfp-links.json");
    const saved = JSON.parse(await readFile(file, "utf-8"));
    expect(saved.books[0].links.map((l: { tdfp: string }) => l.tdfp)).toEqual([
      "linked1",
      "other",
      "acme1",
    ]);
    const cache = JSON.parse(await readFile(spoolsCachePath(), "utf-8"));
    expect(cache.stale).toBe(true);
  });

  it("says where print settings come from", () => {
    const item = {
      spool: {} as never,
      calibrated: true,
      profile: { settings: { printTemp: 245, bedTemp: 65, flowRatio: 0.95 } } as never,
    };
    expect(importSettingsText(item)).toBe(
      "print 245°C · bed 65°C · flow 0.95 (your calibration, then 3DFP's record)",
    );
    expect(importSettingsText({ ...item, profile: {} as never })).toBe(
      "Generic's print settings (3DFP has none)",
    );
  });
});

function spooleaseSpool(id: string): SpoolRecord {
  return {
    id,
    tagId: "",
    material: "PETG",
    subtype: "",
    colorName: "",
    colorCodes: [],
    note: "",
    brand: "",
    labelWeight: 1000,
    coreWeight: 180,
    fullWeight: null,
    currentWeight: null,
    consumedSinceWeighed: 0,
    slicerFilament: "",
    addedTime: null,
    location: "",
  };
}
