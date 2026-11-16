// ABOUTME: Tests for filling the local catalog from the 3DFilamentProfiles API without overspending the monthly quota.
// ABOUTME: Covers on-demand full records (refresh only when asked), fill searches with resume, and the month-end fill.

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { QuotaLedger } from "../src/apiQuota.js";
import { FilamentCatalog } from "../src/filamentCatalog.js";
import { type CatalogApi, filamentRecord, fillFilters, fillSearch, monthEndFill, searchOnline } from "../src/filamentCatalogSync.js";
import { FilamentProfilesClient } from "../src/filamentProfiles.js";
import { type FilamentProfilesServer, type ServerFilament, serverFilament, startFilamentProfilesServer, TEST_API_KEY } from "./filamentProfilesServer.js";

const T0 = new Date("2026-11-15T13:00:00Z");
const days = (n: number) => new Date(T0.getTime() + n * 86_400_000);

function brandOf(key: string, count: number, firstId: number, material = "pla"): ServerFilament[] {
  return Array.from({ length: count }, (_, i) =>
    serverFilament({ id: firstId + i, brand_key: key, brand_name: key.toUpperCase(), material_key: material, material: material.toUpperCase(), color: `Color ${i}` }),
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
      expect(await filamentRecord(api, 101, { refreshStale: true })).toMatchObject({ fetched: false, stale: false });
      expect(calls()).toBe(1);
    });

    it("keeps the old record, with a warning, when a refresh fails", async () => {
      await filamentRecord(api, 101);
      now = days(40);
      server.replies["/api/v1/filaments/101"] = { status: 500, body: { error: { code: "internal", message: "An unexpected error occurred" } } };
      const kept = await filamentRecord(api, 101, { refreshStale: true });
      expect(kept).toMatchObject({ fetched: false, stale: true, ageDays: 40 });
      expect(kept.warning).toBe("couldn't refresh Sunlu PETG Vivid Yellow (3DFilamentProfiles: An unexpected error occurred (internal)): using the copy from 2026-11-15");
    });

    it("throws when there's no record to fall back on", async () => {
      await expect(filamentRecord(api, 999)).rejects.toThrow(/No filament matches/);
    });

    it("follows a merge to the surviving filament, locally afterwards", async () => {
      server.replies["/api/v1/filaments/101"] = { status: 200, body: { ...serverFilament({ id: 205 }), stores: [] } };
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

  describe("fillFilters", () => {
    it("reads a fill key's filters", () => {
      expect(fillFilters("all")).toEqual({});
      expect(fillFilters("brand:sunlu")).toEqual({ brand: "sunlu" });
      expect(fillFilters("brand:esun,material:pla")).toEqual({ brand: "esun", material: "pla" });
    });
  });

  describe("fillSearch", () => {
    it("pages through a search until a short page", async () => {
      server.filaments = brandOf("esun", 120, 1);
      const result = await fillSearch(api, "brand:esun");
      expect(result).toEqual({ key: "brand:esun", calls: 3, saved: 120, complete: true, truncated: false, stoppedBy: null });
      expect(server.requests.map((r) => r.query)).toEqual([1, 2, 3].map((page) => ({ brand: "esun", limit: "50", page: String(page) })));
      expect(api.catalog.stats()).toMatchObject({ filaments: 120, completeBrands: 1 });
    });

    it("skips a search completed in the last 30 days", async () => {
      server.filaments = brandOf("esun", 10, 1);
      await fillSearch(api, "brand:esun");
      now = days(29);
      expect(await fillSearch(api, "brand:esun")).toMatchObject({ calls: 0, complete: true });
      now = days(30);
      expect(await fillSearch(api, "brand:esun")).toMatchObject({ calls: 1, complete: true });
    });

    it("stops at the reserve and resumes where it stopped", async () => {
      server.filaments = brandOf("esun", 120, 1);
      server.quota.remaining = 102;
      const stopped = await fillSearch(api, "brand:esun", { reserve: 100 });
      expect(stopped).toMatchObject({ calls: 2, saved: 100, complete: false });
      expect(stopped.stoppedBy).toMatch(/kept in reserve/);
      expect(api.catalog.fill("brand:esun")).toMatchObject({ nextPage: 3, complete: false });

      // The quota comes back with the new month; the fill picks up at page 3.
      now = new Date("2026-12-01T01:00:00Z");
      server.quota.remaining = 1000;
      const resumed = await fillSearch(api, "brand:esun", { reserve: 100 });
      expect(resumed).toMatchObject({ calls: 1, saved: 20, complete: true });
      expect(server.requests.at(-1)?.query.page).toBe("3");
    });

    it("counts a search the API refuses as done, since it won't work next time either", async () => {
      server.replies["/api/v1/filaments"] = { status: 400, body: { error: { code: "invalid_parameter", message: "Unknown brand" } } };
      expect(await fillSearch(api, "brand:nope")).toMatchObject({ calls: 1, complete: true, stoppedBy: null });
    });

    it("stops, without marking the search done, when the key is rejected or the account has no access", async () => {
      server.filaments = brandOf("esun", 10, 1);
      for (const [status, message] of [
        [401, /rejected the API key/],
        [402, /no active API access/],
      ] as const) {
        server.replies["/api/v1/filaments"] = { status, body: { error: { code: "x", message: "x" } } };
        const stopped = await fillSearch(api, "brand:esun");
        expect(stopped).toMatchObject({ calls: 1, complete: false });
        expect(stopped.stoppedBy).toMatch(message);
        expect(api.catalog.fill("brand:esun")).toMatchObject({ nextPage: 1, complete: false });
      }
      // Once the key works again, the search runs instead of being skipped for 30 days.
      delete server.replies["/api/v1/filaments"];
      expect(await fillSearch(api, "brand:esun")).toMatchObject({ calls: 1, saved: 10, complete: true });
    });

    it("marks a search with more than 20 full pages as truncated", async () => {
      server.filaments = brandOf("big", 1001, 1);
      expect(await fillSearch(api, "brand:big")).toMatchObject({ calls: 20, saved: 1000, complete: true, truncated: true });
    });
  });

  describe("monthEndFill", () => {
    it("waits for the 28th (UTC) unless forced", async () => {
      expect(await monthEndFill(api, {})).toEqual({ ran: false, reason: "the month-end fill starts on 2026-11-28 (UTC)", calls: 0, records: 0, searches: [] });
      expect(calls()).toBe(0);
    });

    it("fills owned filaments' records, their brands, other known brands, then discovers more, down to the reserve", async () => {
      now = new Date("2026-11-28T03:00:00Z");
      server.filaments = [...brandOf("sunlu", 60, 1, "petg"), ...brandOf("esun", 10, 100), ...brandOf("polymaker", 5, 200), ...brandOf("overture", 5, 300)];
      api.catalog.saveSummaries([{ ...(await summaryOf(100)) }], T0);
      const report = await monthEndFill(api, { ownedFilamentIds: [1] });
      expect(report).toMatchObject({ ran: true, records: 1, reason: "nothing left to fill" });
      const keys = report.searches.map((s) => s.key);
      expect(keys.slice(0, 7)).toEqual(["brand:sunlu", "brand:esun", "all", "brand:overture", "brand:polymaker", "material:petg", "material:pla"]);
      // Common materials no page has shown yet are tried too, once each.
      expect(keys).toContain("material:abs");
      expect(new Set(keys).size).toBe(keys.length);
      const paths = server.requests.map((r) => `${r.path}?${new URLSearchParams(r.query)}`);
      expect(paths.slice(0, 4)).toEqual([
        "/api/v1/filaments/1?",
        "/api/v1/filaments?brand=sunlu&limit=50&page=1",
        "/api/v1/filaments?brand=sunlu&limit=50&page=2",
        "/api/v1/filaments?brand=esun&limit=50&page=1",
      ]);
      expect(api.catalog.stats()).toMatchObject({ filaments: 80, records: 1 });

      async function summaryOf(id: number) {
        const raw = server.filaments.find((f) => f.id === id);
        if (!raw) throw new Error("no such filament");
        return {
          id: raw.id,
          brandKey: raw.brand_key,
          brandName: raw.brand_name,
          materialKey: raw.material_key,
          material: raw.material,
          materialTypeKey: null,
          materialType: null,
          color: raw.color,
          rgb: raw.rgb,
          tdValue: null,
          discontinued: false,
          url: "",
        };
      }
    });

    it("skips an owned filament the API no longer has, and fills the rest", async () => {
      now = new Date("2026-11-28T03:00:00Z");
      server.filaments = brandOf("esun", 10, 1);
      const report = await monthEndFill(api, { ownedFilamentIds: [999, 1] });
      expect(report).toMatchObject({ ran: true, records: 1, reason: "nothing left to fill" });
      expect(server.requests.slice(0, 2).map((r) => r.path)).toEqual(["/api/v1/filaments/999", "/api/v1/filaments/1"]);
      expect(report.searches.map((s) => s.key)).toContain("brand:esun");
    });

    it("stops at the first call when the account has no access, marking nothing done", async () => {
      now = new Date("2026-11-28T03:00:00Z");
      server.filaments = brandOf("esun", 10, 1);
      server.access = "no_access";
      const owned = await monthEndFill(api, { ownedFilamentIds: [1] });
      expect(owned).toMatchObject({ calls: 1, records: 0, searches: [] });
      expect(owned.reason).toMatch(/no active API access/);

      const searching = await monthEndFill(api, {});
      expect(searching.searches).toHaveLength(1);
      expect(searching.reason).toMatch(/no active API access/);
      expect(api.catalog.fills().filter((fill) => fill.complete)).toEqual([]);
    });

    it("stops at the reserve of 100", async () => {
      now = new Date("2026-11-29T03:00:00Z");
      server.filaments = brandOf("esun", 500, 1);
      server.quota.remaining = 104;
      const report = await monthEndFill(api, { force: true });
      expect(report.calls).toBe(4);
      expect(report.reason).toMatch(/kept in reserve/);
      expect(server.quota.remaining).toBe(100);
    });

    it("splits a truncated brand by the materials it has", async () => {
      now = new Date("2026-11-28T03:00:00Z");
      server.filaments = [...brandOf("big", 1001, 1, "pla"), ...brandOf("big", 30, 5000, "petg")];
      api.catalog.saveSummaries([{ id: 1, brandKey: "big", brandName: "BIG", materialKey: "pla", material: "PLA", materialTypeKey: null, materialType: null, color: "x", rgb: null, tdValue: null, discontinued: false, url: "" }], T0);
      const report = await monthEndFill(api, {});
      const keys = report.searches.map((s) => s.key);
      expect(keys.slice(0, 2)).toEqual(["brand:big", "brand:big,material:pla"]);
      expect(keys).toContain("brand:big,material:petg");
    });
  });
});
