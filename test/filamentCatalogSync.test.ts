// ABOUTME: Tests for filling the local catalog from the 3DFilamentProfiles API without overspending the monthly quota.
// ABOUTME: Covers on-demand full records (refresh only when asked, filament-db's copy first) and online searches.

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QuotaLedger } from "../src/apiQuota.js";
import { FilamentCatalog } from "../src/filamentCatalog.js";
import { type CatalogApi, filamentRecord, searchOnline } from "../src/filamentCatalogSync.js";
import { FilamentProfilesClient } from "../src/filamentProfiles.js";
import { FILAMENT_DB_FIXTURE } from "./filamentDbFixture.js";
import {
  type FilamentProfilesServer,
  type ServerFilament,
  serverFilament,
  startFilamentProfilesServer,
  TEST_API_KEY,
} from "./filamentProfilesServer.js";

const T0 = new Date("2026-11-15T13:00:00Z");
const days = (n: number) => new Date(T0.getTime() + n * 86_400_000);

function brandOf(key: string, count: number, firstId: number, material = "pla"): ServerFilament[] {
  return Array.from({ length: count }, (_, i) =>
    serverFilament({
      id: firstId + i,
      brand_key: key,
      brand_name: key.toUpperCase(),
      material_key: material,
      material: material.toUpperCase(),
      color: `Color ${i}`,
    }),
  );
}

describe("catalog sync", () => {
  let server: FilamentProfilesServer;
  let api: CatalogApi;
  let now: Date;

  beforeEach(async () => {
    server = await startFilamentProfilesServer();
    const dir = await mkdtemp(join(tmpdir(), "bh-catalog-sync-"));
    now = T0;
    const clock = () => now;
    const ledger = new QuotaLedger(join(dir, "quota.json"), "acct1", clock);
    api = {
      client: new FilamentProfilesClient({ key: TEST_API_KEY, base: server.url, ledger }),
      catalog: FilamentCatalog.open(join(dir, "catalog.sqlite")),
      ledger,
      now: clock,
    };
  });

  afterEach(async () => {
    api.catalog.close();
    await server.close();
  });

  const calls = () => server.requests.length;

  describe("filamentRecord", () => {
    beforeEach(() => {
      server.filaments = [serverFilament()];
    });

    it("fetches a missing record once, then reads it locally", async () => {
      const first = await filamentRecord(api, 101);
      expect(first).toMatchObject({ fetched: true, stale: false, ageDays: 0, warning: null });
      expect(first.entry.record).toMatchObject({ id: 101, tempMin: 230, flowRatio: 0.95 });
      const again = await filamentRecord(api, 101);
      expect(again).toMatchObject({ fetched: false, stale: false });
      expect(calls()).toBe(1);
    });

    it("uses a 30-day-old record as it is unless asked to refresh", async () => {
      await filamentRecord(api, 101);
      server.filaments = [serverFilament({ flow_ratio: 0.91 })];
      now = days(31);
      const kept = await filamentRecord(api, 101);
      expect(kept).toMatchObject({ fetched: false, stale: true, ageDays: 31 });
      expect(kept.entry.record?.flowRatio).toBe(0.95);
      expect(calls()).toBe(1);

      const refreshed = await filamentRecord(api, 101, { refreshStale: true });
      expect(refreshed).toMatchObject({ fetched: true, stale: false, ageDays: 0 });
      expect(refreshed.entry.record?.flowRatio).toBe(0.91);
      expect(calls()).toBe(2);
    });

    it("doesn't refetch a fresh record even when refresh is on", async () => {
      await filamentRecord(api, 101);
      now = days(29);
      expect(await filamentRecord(api, 101, { refreshStale: true })).toMatchObject({
        fetched: false,
        stale: false,
      });
      expect(calls()).toBe(1);
    });

    it("keeps the old record, with a warning, when a refresh fails", async () => {
      await filamentRecord(api, 101);
      now = days(40);
      server.replies["/api/v1/filaments/101"] = {
        status: 500,
        body: { error: { code: "internal", message: "An unexpected error occurred" } },
      };
      const kept = await filamentRecord(api, 101, { refreshStale: true });
      expect(kept).toMatchObject({ fetched: false, stale: true, ageDays: 40 });
      expect(kept.warning).toBe(
        "couldn't refresh Sunlu PETG Vivid Yellow (3DFilamentProfiles: An unexpected error occurred (internal)): using the copy from 2026-11-15",
      );
    });

    it("throws when there's no record to fall back on", async () => {
      await expect(filamentRecord(api, 999)).rejects.toThrow(/No filament matches/);
    });

    describe("with filament-db's export", () => {
      // The fixture's record of filament 32336 was fetched 2026-11-27T18:03:20.800Z.
      const FETCHED = new Date("2026-11-27T18:03:20.800Z");
      const daysAfter = (n: number) => new Date(FETCHED.getTime() + n * 86_400_000);

      beforeEach(() => {
        vi.stubEnv("FILAMENT_DB_EXPORT", FILAMENT_DB_FIXTURE);
        server.filaments = [
          serverFilament({ id: 32336, flow_ratio: 0.91 }),
          serverFilament({ id: 16899 }),
        ];
      });

      afterEach(() => {
        vi.unstubAllEnvs();
      });

      it("takes a fresh record from the export without a call", async () => {
        now = daysAfter(3);
        const found = await filamentRecord(api, 32336);
        expect(found).toMatchObject({
          fetched: false,
          fromExport: true,
          stale: false,
          ageDays: 3,
          warning: null,
        });
        expect(found.entry.record).toMatchObject({ id: 32336, tempMin: 230, flowRatio: 0.95 });
        expect(found.entry.recordAt).toEqual(FETCHED);
        expect(calls()).toBe(0);
      });

      it("calls the API when the export's record is 30 days old", async () => {
        now = daysAfter(30);
        const found = await filamentRecord(api, 32336);
        expect(found).toMatchObject({ fetched: true, fromExport: false });
        expect(found.entry.record?.flowRatio).toBe(0.91);
        expect(calls()).toBe(1);
      });

      it("calls the API for a filament the export knows only from a search", async () => {
        now = daysAfter(1);
        expect(await filamentRecord(api, 16899)).toMatchObject({ fetched: true });
        expect(calls()).toBe(1);
      });

      it("keeps the catalog's own record when it's newer than the export's", async () => {
        now = daysAfter(1);
        await filamentRecord(api, 32336, { refreshStale: true });
        expect(calls()).toBe(0);
        api.catalog.saveRecord(32336, await api.client.getFilament(32336), daysAfter(2));
        now = daysAfter(3);
        const found = await filamentRecord(api, 32336);
        expect(found).toMatchObject({ fetched: false, fromExport: false, ageDays: 1 });
        expect(found.entry.record?.flowRatio).toBe(0.91);
      });
    });

    it("follows a merge to the surviving filament, locally afterwards", async () => {
      server.replies["/api/v1/filaments/101"] = {
        status: 200,
        body: { ...serverFilament({ id: 205 }), stores: [] },
      };
      expect((await filamentRecord(api, 101)).entry.filament.id).toBe(205);
      expect((await filamentRecord(api, 101)).fetched).toBe(false);
      expect(calls()).toBe(1);
    });
  });

  it("searches online in one call and keeps the results", async () => {
    server.filaments = brandOf("sunlu", 3, 1);
    const page = await searchOnline(api, { brand: "sunlu" });
    expect(page.filaments).toHaveLength(3);
    expect(api.catalog.search({ brand: "sunlu" })).toHaveLength(3);
    expect(calls()).toBe(1);
  });
});
