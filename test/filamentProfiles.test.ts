// ABOUTME: Tests for the 3DFilamentProfiles API client against a local stand-in server.
// ABOUTME: Covers the pinned origin, auth, quota bookkeeping, local validation that saves calls, and error messages.

import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { QuotaError, QuotaLedger } from "../src/apiQuota.js";
import {
  apiBase,
  FILAMENT_PROFILES_API,
  FilamentProfilesClient,
  FilamentProfilesError,
} from "../src/filamentProfiles.js";
import {
  type FilamentProfilesServer,
  serverFilament,
  serverSpool,
  startFilamentProfilesServer,
  TEST_API_KEY,
} from "./filamentProfilesServer.js";

describe("apiBase", () => {
  it("is the real API unless overridden", () => {
    expect(apiBase({})).toBe(FILAMENT_PROFILES_API);
    expect(FILAMENT_PROFILES_API).toBe("https://3dfilamentprofiles.com/api/v1");
  });

  it("can point at a server on this machine, for tests", () => {
    for (const url of [
      "http://127.0.0.1:4321/api/v1",
      "http://localhost:4321/api/v1",
      "http://[::1]:4321/api/v1/",
    ]) {
      expect(apiBase({ FILAMENTPROFILES_API_URL: url })).toBe(url.replace(/\/$/, ""));
    }
  });

  it("refuses to send the key anywhere else", () => {
    for (const url of [
      "https://evil.example/api/v1",
      "http://192.168.1.5/api/v1",
      "http://3dfilamentprofiles.com/api/v1",
      "not a url",
    ]) {
      expect(() => apiBase({ FILAMENTPROFILES_API_URL: url })).toThrow(
        /refusing to send the 3DFilamentProfiles API key/,
      );
    }
  });
});

describe("FilamentProfilesClient", () => {
  let server: FilamentProfilesServer;
  let ledger: QuotaLedger;
  let client: FilamentProfilesClient;

  beforeEach(async () => {
    server = await startFilamentProfilesServer();
    ledger = new QuotaLedger(
      join(await mkdtemp(join(tmpdir(), "bh-3dfp-")), "quota.json"),
      "acct1",
    );
    client = new FilamentProfilesClient({ key: TEST_API_KEY, base: server.url, ledger });
  });

  afterEach(async () => {
    await server.close();
  });

  it("sends the key as a bearer token, and only there", async () => {
    await client.listSpools();
    const request = server.requests[0];
    if (!request) throw new Error("no request reached the server");
    expect(request.headers.authorization).toBe(`Bearer ${TEST_API_KEY}`);
    expect(request.headers["x-api-key"]).toBeUndefined();
    expect(request.headers.accept).toBe("application/json");
    expect(request.headers["user-agent"]).toBe("bambu-hando");
  });

  it("lists every spool in one call", async () => {
    server.spools = [
      serverSpool(),
      serverSpool({ short_code: "XYZ789", location: null, rgb: null, remaining_grams: 0 }),
    ];
    const { spools, deleted, asOf } = await client.listSpools();
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.query).toEqual({});
    expect(deleted).toEqual([]);
    expect(asOf).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(spools[0]).toEqual({
      shortCode: "ABC123",
      filamentId: 101,
      brand: "Sunlu",
      material: "PETG",
      materialType: null,
      color: "Vivid Yellow",
      rgb: "#FFD700",
      remainingGrams: 740,
      emptySpoolWeight: 189,
      location: "Shelf A",
      notes: null,
      updatedAt: "2026-10-14T18:02:11.000Z",
      url: "https://spooldb.com/s/ABC123",
      externalId: null,
      spoolProperties: null,
    });
    expect(spools[1]).toMatchObject({
      shortCode: "XYZ789",
      location: null,
      rgb: null,
      remainingGrams: 0,
    });
  });

  it("lists only the spools changed since a time, and the ones deleted since", async () => {
    server.spools = [
      serverSpool({ updated_at: "2026-11-01T00:00:00.000Z" }),
      serverSpool({ short_code: "NEW777", updated_at: "2026-11-18T09:00:00.000Z" }),
    ];
    server.deleted = [
      { short_code: "OLD111", deleted_at: "2026-11-02T00:00:00.000Z" },
      { short_code: "XYZ789", deleted_at: "2026-11-19T00:00:00.000Z" },
    ];
    const changes = await client.listSpools("2026-11-18T09:00:00Z");
    expect(server.requests[0]?.query).toEqual({ updated_since: "2026-11-18T09:00:00Z" });
    expect(changes.spools.map((s) => s.shortCode)).toEqual(["NEW777"]);
    expect(changes.deleted).toEqual(["XYZ789"]);
    expect(changes.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("refuses a since time without a timezone without spending a call", async () => {
    for (const since of ["2026-11-18T09:00:00", "2026-11-18", "yesterday", ""])
      await expect(client.listSpools(since)).rejects.toThrow(FilamentProfilesError);
    expect(server.requests).toHaveLength(0);
  });

  it("updates several spools in one call, each with its own fields and result", async () => {
    server.spools = [serverSpool(), serverSpool({ short_code: "XYZ789", remaining_grams: 500 })];
    const results = await client.updateSpools([
      { shortCode: "ABC123", remainingGrams: 600 },
      { shortCode: "NOPE99", usedGrams: 18 },
      { shortCode: "XYZ789", bambuTagId: "04A1B2C3D4E5F6" },
    ]);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({
      method: "PATCH",
      path: "/api/v1/my/spools",
      body: [
        { short_code: "ABC123", remaining_grams: 600 },
        { short_code: "NOPE99", used_grams: 18 },
        { short_code: "XYZ789", bambu_tag_id: "04A1B2C3D4E5F6" },
      ],
    });
    expect(results).toEqual([
      {
        shortCode: "ABC123",
        ok: true,
        update: expect.objectContaining({ shortCode: "ABC123", remainingGrams: 600 }),
      },
      {
        shortCode: "NOPE99",
        ok: false,
        error: "3DFilamentProfiles: Spool not found (not_found)",
        code: "not_found",
      },
      {
        shortCode: "XYZ789",
        ok: true,
        update: expect.objectContaining({ bambuTagId: "04A1B2C3D4E5F6" }),
      },
    ]);
  });

  it("refuses a bulk update the API would refuse without spending a call", async () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ shortCode: `S${i}`, usedGrams: 1 }));
    for (const updates of [
      [],
      many,
      [{ shortCode: "", usedGrams: 1 }],
      [{ shortCode: "ABC123" }],
      [{ shortCode: "ABC123", remainingGrams: 10, usedGrams: 5 }],
    ])
      await expect(client.updateSpools(updates)).rejects.toThrow(FilamentProfilesError);
    expect(server.requests).toHaveLength(0);
    server.spools = [serverSpool()];
    await client.updateSpools(many.slice(0, 50));
    expect(server.requests).toHaveLength(1);
  });

  it("fails a bulk update whose results don't line up with what was sent", async () => {
    server.replies["PATCH /api/v1/my/spools"] = {
      status: 200,
      body: { data: [{ short_code: "ABC123", remaining_grams: 600 }] },
    };
    await expect(
      client.updateSpools([
        { shortCode: "ABC123", remainingGrams: 600 },
        { shortCode: "XYZ789", remainingGrams: 600 },
      ]),
    ).rejects.toThrow(/2 updates/);
    server.replies["PATCH /api/v1/my/spools"] = {
      status: 200,
      body: { data: [{ short_code: "XYZ789", remaining_grams: 600 }] },
    };
    const [result] = await client.updateSpools([{ shortCode: "ABC123", remainingGrams: 600 }]);
    expect(result).toMatchObject({ shortCode: "ABC123", ok: false });
  });

  it("reads, sets and clears the ID another app keeps for a spool", async () => {
    server.spools = [serverSpool({ external_id: "spoolease:3" })];
    expect((await client.listSpools()).spools[0]?.externalId).toBe("spoolease:3");
    expect((await client.getSpool("ABC123")).externalId).toBe("spoolease:3");
    await client.updateSpools([{ shortCode: "ABC123", externalId: null }]);
    expect(server.requests.at(-1)?.body).toEqual([{ short_code: "ABC123", external_id: null }]);
    expect(server.spools[0]?.external_id).toBeNull();
    server.filaments = [serverFilament()];
    await client.addSpool({ filamentId: 101, externalId: "spoolease:4" });
    expect(server.requests.at(-1)?.body).toEqual({ filament_id: 101, external_id: "spoolease:4" });
    expect(server.spools[1]?.external_id).toBe("spoolease:4");
    const before = server.requests.length;
    const long = "x".repeat(101);
    await expect(client.updateSpool("ABC123", { externalId: long })).rejects.toThrow(
      FilamentProfilesError,
    );
    await expect(client.addSpool({ filamentId: 101, externalId: long })).rejects.toThrow(
      FilamentProfilesError,
    );
    expect(server.requests).toHaveLength(before);
  });

  it("reads a spool's generated profile: which values are its own calibration", async () => {
    server.spools = [
      serverSpool({
        spool_properties: { purchase_date: null, nozzle_temp: 250, flow_ratio: 0.97 },
      }),
    ];
    expect((await client.listSpools()).spools[0]?.spoolProperties).toEqual({
      purchase_date: null,
      nozzle_temp: 250,
      flow_ratio: 0.97,
    });
    const profile = await client.spoolProfile("ABC123");
    expect(server.requests.at(-1)).toMatchObject({
      path: "/api/v1/my/spools/ABC123/profile",
      query: { slicer: "bambu", pressure_advance: "true" },
    });
    expect(profile.applied).toEqual(
      expect.arrayContaining([
        { key: "nozzle_temperature", value: "250", source: "spool" },
        { key: "filament_flow_ratio", value: "0.97", source: "spool" },
      ]),
    );
  });

  it("gets one spool with its Bambu IDs, which the list leaves out", async () => {
    server.spools = [
      serverSpool({ short_code: "A/B 1", bambu_tag_id: "4C626FE6", bambu_spool_id: null }),
    ];
    const spool = await client.getSpool("A/B 1");
    expect(server.requests[0]?.path).toBe("/api/v1/my/spools/A%2FB%201");
    expect(spool).toMatchObject({
      shortCode: "A/B 1",
      brand: "Sunlu",
      bambuTagId: "4C626FE6",
      bambuSpoolId: null,
    });
  });

  it("updates a spool with only the fields given", async () => {
    server.spools = [serverSpool()];
    const update = await client.updateSpool("ABC123", { usedGrams: 42, bambuTagId: "4C626FE6" });
    expect(server.requests[0]).toMatchObject({
      method: "PATCH",
      body: { used_grams: 42, bambu_tag_id: "4C626FE6" },
    });
    expect(server.requests[0]?.headers["content-type"]).toBe("application/json");
    expect(update).toEqual({
      shortCode: "ABC123",
      remainingGrams: 698,
      deductedGrams: 42,
      location: "Shelf A",
      bambuSpoolId: null,
      bambuTagId: "4C626FE6",
    });
  });

  it("sends null to clear a location or ID", async () => {
    server.spools = [serverSpool({ bambu_tag_id: "4C626FE6" })];
    await client.updateSpool("ABC123", { location: null, bambuTagId: null });
    expect(server.requests[0]?.body).toEqual({ location: null, bambu_tag_id: null });
  });

  it("rejects an update the API would refuse without spending a call", async () => {
    const bad = [
      {},
      { remainingGrams: 10, usedGrams: 5 },
      { remainingGrams: 10.5 },
      { remainingGrams: 10001 },
      { usedGrams: 0 },
      { usedMm: 1_000_001 },
      { location: "" },
      { location: "x".repeat(201) },
      { bambuTagId: "x".repeat(65) },
    ];
    for (const patch of bad)
      await expect(client.updateSpool("ABC123", patch)).rejects.toThrow(FilamentProfilesError);
    expect(server.requests).toHaveLength(0);
  });

  it("adds a spool, or reports the ones already owned", async () => {
    server.filaments = [serverFilament()];
    const added = await client.addSpool({
      filamentId: 101,
      remainingGrams: 1000,
      ifNotOwned: true,
    });
    expect(server.requests[0]?.body).toEqual({
      filament_id: 101,
      remaining_grams: 1000,
      if_not_owned: true,
    });
    expect(added).toMatchObject({
      created: true,
      spool: { shortCode: "NEW001", filamentId: 101, remainingGrams: 1000 },
    });

    const again = await client.addSpool({ filamentId: 101, ifNotOwned: true });
    expect(again).toEqual({ created: false, existing: ["NEW001"] });
  });

  it("adds a spool with its tag in the same call", async () => {
    server.filaments = [serverFilament()];
    const added = await client.addSpool({ filamentId: 101, bambuTagId: "04A1B2C3D4E5F6" });
    expect(server.requests[0]?.body).toEqual({ filament_id: 101, bambu_tag_id: "04A1B2C3D4E5F6" });
    expect(added).toMatchObject({ created: true, spool: { bambuTagId: "04A1B2C3D4E5F6" } });
    await expect(client.addSpool({ filamentId: 101, bambuTagId: "x".repeat(65) })).rejects.toThrow(
      FilamentProfilesError,
    );
    expect(server.requests).toHaveLength(1);
  });

  it("searches filaments with the documented filters and page bounds", async () => {
    server.filaments = [serverFilament(), serverFilament({ id: 102, color: "Black" })];
    const page = await client.listFilaments({
      brand: "sunlu",
      material: "petg",
      q: "black",
      limit: 50,
    });
    expect(server.requests[0]?.query).toEqual({
      brand: "sunlu",
      material: "petg",
      q: "black",
      limit: "50",
    });
    expect(page).toMatchObject({
      page: 1,
      limit: 50,
      total: 1,
      totalIsEstimate: false,
      last: true,
    });
    expect(page.filaments).toEqual([
      expect.objectContaining({
        id: 102,
        brandKey: "sunlu",
        brandName: "Sunlu",
        materialKey: "petg",
        color: "Black",
        discontinued: false,
      }),
    ]);

    for (const filters of [
      { limit: 51 },
      { page: 21 },
      { q: "x".repeat(101) },
      { gtin: "123" },
      { gtin: "12345678", page: 2 },
    ]) {
      await expect(client.listFilaments(filters)).rejects.toThrow(FilamentProfilesError);
    }
    expect(server.requests).toHaveLength(1);
  });

  it("gets a filament's full record, keeping the id the server returns", async () => {
    server.filaments = [serverFilament({ id: 205 })];
    server.replies["/api/v1/filaments/101"] = {
      status: 200,
      body: { ...serverFilament({ id: 205 }), stores: [] },
    };
    const filament = await client.getFilament(101);
    expect(filament).toMatchObject({
      id: 205,
      tempMin: 230,
      tempMax: 250,
      bedTempMin: 70,
      bedTempMax: 80,
      density: 1270,
      diameter: 1750,
      nominalWeight: 1000,
      spoolWeight: 189,
    });
    expect(filament).toMatchObject({
      chamberTemp: null,
      dryTempMax: 65,
      dryTime: 6,
      flowRatio: 0.95,
      kValue: 0.04,
      maxVolumetricSpeed: 16,
      softeningTemp: 78,
    });
  });

  it("leaves store prices out of a filament's record, since they change daily", async () => {
    server.filaments = [serverFilament()];
    expect(await client.getFilament(101)).not.toHaveProperty("stores");
  });

  it("records the server's quota numbers after every call", async () => {
    server.quota.remaining = 500;
    await client.listSpools();
    expect(await ledger.current()).toMatchObject({ limit: 1000, remaining: 499, exact: true });
  });

  it("refuses a call once the server has said the quota is used up", async () => {
    server.quota.remaining = 0;
    await expect(client.listSpools()).rejects.toThrow(QuotaError);
    expect(await ledger.current()).toMatchObject({ remaining: 0, exact: true });
    await expect(client.listSpools()).rejects.toThrow(/used up until/);
    expect(server.requests).toHaveLength(1);
  });

  it("explains a rejected key, which costs nothing", async () => {
    server.quota.remaining = 500;
    await client.listSpools();
    const wrong = new FilamentProfilesClient({
      key: `${TEST_API_KEY}_regenerated`,
      base: server.url,
      ledger,
    });
    const err = await wrong.listSpools().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FilamentProfilesError);
    expect(err).toMatchObject({ status: 401, code: "invalid_key" });
    expect(String(err)).toContain("bambu-hando key set 3dfp");
    expect(String(err)).not.toContain("_regenerated");
    expect(await ledger.current()).toMatchObject({ remaining: 499 });
  });

  it("explains lapsed API access", async () => {
    server.access = "no_access";
    await expect(client.listSpools()).rejects.toThrow(/no active API access/);
  });

  it("passes on the server's own message for other errors", async () => {
    server.spools = [serverSpool()];
    const err = await client.updateSpool("ABC123", { location: "Garage" }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 422, code: "invalid_location" });
    expect(String(err)).toContain(
      "3DFilamentProfiles: No saved location has that name (invalid_location)",
    );
  });

  it("reports an unreadable error body by its status", async () => {
    server.replies["/api/v1/my/spools"] = { status: 500, body: "oops" };
    await expect(client.listSpools()).rejects.toThrow("3DFilamentProfiles answered HTTP 500");
  });

  it("counts an unreachable server as a spent call and says what failed", async () => {
    server.quota.remaining = 500;
    await client.listSpools();
    await server.close();
    await expect(client.listSpools()).rejects.toThrow(/can't reach 3DFilamentProfiles/);
    expect(await ledger.current()).toMatchObject({ remaining: 498, exact: false });
  });

  it("still returns the reply when the quota file can't be written", async () => {
    const notADir = join(await mkdtemp(join(tmpdir(), "bh-3dfp-")), "file");
    await writeFile(notADir, "", "utf-8");
    const unwritable = new FilamentProfilesClient({
      key: TEST_API_KEY,
      base: server.url,
      ledger: new QuotaLedger(join(notADir, "quota.json"), "acct1"),
    });
    expect((await unwritable.listSpools()).spools).toHaveLength(server.spools.length);
    await server.close();
    await expect(unwritable.listSpools()).rejects.toThrow(/can't reach 3DFilamentProfiles/);
  });

  it("never repeats the key in an error from sending the request", async () => {
    // fetch refuses a header value with a newline and quotes it in its error.
    const mangled = new FilamentProfilesClient({ key: "3dfp_LEAK\nME", base: server.url, ledger });
    const err: unknown = await mangled.listSpools().catch((e: unknown) => e);
    expect((err as Error).message).toMatch(/can't reach 3DFilamentProfiles/);
    expect((err as Error).message).not.toContain("LEAK");
  });

  it("never follows a redirect, so the key can't be forwarded", async () => {
    const elsewhere: string[] = [];
    const other = createServer((req, res) => {
      elsewhere.push(String(req.headers.authorization));
      res.end("{}");
    });
    await new Promise<void>((resolve) => other.listen(0, "127.0.0.1", resolve));
    server.replies["/api/v1/my/spools"] = {
      status: 302,
      body: {},
      headers: { Location: `http://127.0.0.1:${(other.address() as AddressInfo).port}/steal` },
    };
    await expect(client.listSpools()).rejects.toThrow(
      "3DFilamentProfiles answered with a redirect (HTTP 302), which bambu-hando never follows",
    );
    expect(elsewhere).toEqual([]);
    await new Promise<void>((resolve) => other.close(() => resolve()));
  });
});
