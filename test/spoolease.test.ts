// ABOUTME: Tests SpoolEase CSV and spool payload generation against Python reference output.
// ABOUTME: Also covers the encrypted HTTP client against a local SpoolEase protocol server.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildCustomFilamentsCsv, mergeCustomFilamentsCsv, SpoolEaseClient, spoolPayload } from "../src/spoolease.js";
import { expectedCsv, expectedSpoolPayload, parityProfiles, profileAt } from "./parity.js";
import { startSpoolEaseServer, type SpoolEaseServer, TEST_SECURITY_KEY } from "./spooleaseServer.js";

describe("payload builders", () => {
  it("builds the Python CSV keyed by stable filament IDs", () => {
    expect(buildCustomFilamentsCsv(parityProfiles)).toBe(expectedCsv);
  });

  it("keeps a filament's CSV code when its position in the source changes", () => {
    const reordered = buildCustomFilamentsCsv([profileAt(2), profileAt(1)]);
    expect(reordered.split("\r\n").map((line) => line.split(",")[0])).toEqual(["Pd73077d", "Pb1a2a16"]);
  });

  it("strips commas from names because SpoolEase splits CSV lines on every comma", () => {
    const csv = buildCustomFilamentsCsv([{ ...profileAt(2), brand: "Acme, Inc.", name: "Silk, Gold" }]);
    expect(csv.split(",")).toEqual(["Pd73077d", "Acme Inc. Silk Gold", "200", "220", "PLA"]);
  });

  it("doesn't repeat the brand when the name already starts with it", () => {
    const csv = buildCustomFilamentsCsv([{ ...profileAt(0), brand: "Polymaker", name: "Polymaker PolyLite PETG Black" }]);
    expect(csv.split(",")[1]).toBe("Polymaker PolyLite PETG Black");
  });

  it("merges by code: replaces matching rows in place, keeps others, appends new ones", () => {
    const existing = "GFX01,Hand Made,190,230,PLA\n\nPABC1234,Stale,1,2,PETG\r\nGFX02,Other,200,240,ABS";
    const ours = "PNEW0001,New,210,230,PLA\r\nPABC1234,Fresh,230,255,PETG";

    expect(mergeCustomFilamentsCsv(existing, ours).split("\r\n")).toEqual([
      "GFX01,Hand Made,190,230,PLA",
      "PABC1234,Fresh,230,255,PETG",
      "GFX02,Other,200,240,ABS",
      "PNEW0001,New,210,230,PLA",
    ]);
  });

  it("merges into an empty list", () => {
    expect(mergeCustomFilamentsCsv("", "PNEW0001,New,210,230,PLA")).toBe("PNEW0001,New,210,230,PLA");
  });

  it("sends the profile's label and core weights with the spool", () => {
    expect(spoolPayload({ ...profileAt(0), labelWeight: 750, coreWeight: 0 })).toMatchObject({ label_weight: 750, core_weight: 0 });
  });

  it.each(parityProfiles.map((p, i) => [p.name, i] as const))("builds the Python spool payload linked by filament ID for %s", (_name, index) => {
    expect(spoolPayload(profileAt(index))).toEqual(expectedSpoolPayload(index));
  });
});

describe("SpoolEaseClient", () => {
  let server: SpoolEaseServer;
  let client: SpoolEaseClient;

  beforeEach(async () => {
    server = await startSpoolEaseServer();
    client = new SpoolEaseClient({ host: "127.0.0.1", port: server.port, securityKey: TEST_SECURITY_KEY, https: false });
  });

  afterEach(async () => {
    await server.close();
  });

  it("validates the security key", async () => {
    expect(await client.testKey()).toBe(true);
    expect(server.requests).toEqual([{ method: "POST", path: "/api/test-key", body: { test: "Hello" } }]);
  });

  it("fails key validation with the wrong key", async () => {
    const wrong = new SpoolEaseClient({ host: "127.0.0.1", port: server.port, securityKey: "WRONG", https: false });
    expect(await wrong.testKey()).toBe(false);
  });

  it("creates a spool from an encrypted payload and returns its id", async () => {
    expect(await client.addSpool(profileAt(0))).toEqual({ ok: true, id: "1" });
    expect(server.requests[0]?.body).toEqual(expectedSpoolPayload(0));
    expect(server.spools[0]).toMatchObject({ slicer_filament: "PABC1234", spools_count: "1" });
  });

  it("reports a spool SpoolEase failed to store, which it answers with HTTP 200 and plain text", async () => {
    server.replies["/api/spools/add-edit"] = { status: 200, body: "Failed to add spool : storage full", plain: true };

    expect(await client.addSpool(profileAt(0))).toEqual({ ok: false, error: "Failed to add spool : storage full" });
  });

  it("reports a rejected spool payload", async () => {
    server.replies["/api/spools/add-edit"] = { status: 400, body: "Failed to parse JSON body: missing field `x`" };

    expect(await client.addSpool(profileAt(0))).toEqual({ ok: false, error: "HTTP 400: Failed to parse JSON body: missing field `x`" });
  });

  it("reads the stored custom filaments CSV", async () => {
    server.customFilaments = "GFX01,Hand Made,190,230,PLA";

    expect(await client.getCustomFilamentsCsv()).toBe("GFX01,Hand Made,190,230,PLA");
  });

  it("reads an unset custom filaments list as empty", async () => {
    expect(await client.getCustomFilamentsCsv()).toBe("");
  });

  it("throws when the custom filaments list can't be read", async () => {
    server.replies["GET /api/filaments-config"] = { status: 503, body: "busy" };

    await expect(client.getCustomFilamentsCsv()).rejects.toThrow("HTTP 503: busy");
  });

  it("lists the filament IDs that already have spools, parsing quoted CSV fields", async () => {
    server.spools.push(
      { id: "1", note: 'Bought "cheap", twice', brand: "Polymaker", slicer_filament: "PABC1234" },
      { id: "2", note: "multi\nline", slicer_filament: "GFL99" },
      { id: "3", slicer_filament: "" },
    );

    expect(await client.listSpoolFilamentIds()).toEqual(new Set(["PABC1234", "GFL99"]));
  });

  it("throws when spools can't be listed", async () => {
    server.replies["GET /api/spools"] = { status: 500, body: "db locked" };

    await expect(client.listSpoolFilamentIds()).rejects.toThrow("HTTP 500: db locked");
  });

  it("stores the custom filaments CSV", async () => {
    expect(await client.setCustomFilamentsCsv("a,b")).toEqual({ ok: true, id: "" });
    expect(server.requests[0]?.body).toEqual({ custom_filaments: "a,b" });
  });

  it("reports HTTP errors when storing the custom filaments CSV", async () => {
    server.replies["POST /api/filaments-config"] = { status: 500, body: "boom" };

    expect(await client.setCustomFilamentsCsv("a,b")).toEqual({ ok: false, error: "HTTP 500: boom" });
  });

  it("reports custom filaments SpoolEase refused, which it answers with HTTP 200 and an error_text", async () => {
    server.replies["POST /api/filaments-config"] = { status: 200, body: '{"error_text":"Invalid line 2"}' };

    expect(await client.setCustomFilamentsCsv("a,b")).toEqual({ ok: false, error: "Invalid line 2" });
  });
});
