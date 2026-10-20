// ABOUTME: Tests SpoolEase CSV and spool payload generation against Python reference output.
// ABOUTME: Also covers the encrypted HTTP client against a local SpoolEase protocol server.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildCustomFilamentsCsv, SpoolEaseClient, spoolPayload } from "../src/spoolease.js";
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
    expect(server.requests).toEqual([{ path: "/api/test-key", body: { test: "Hello" } }]);
  });

  it("fails key validation with the wrong key", async () => {
    const wrong = new SpoolEaseClient({ host: "127.0.0.1", port: server.port, securityKey: "WRONG", https: false });
    expect(await wrong.testKey()).toBe(false);
  });

  it("sends encrypted spool payloads and decrypts replies", async () => {
    server.replies["/api/spools/add-edit"] = { status: 200, body: '{"id":"42"}' };

    const response = await client.addOrEditSpool(profileAt(0));

    expect(response).toEqual({ status: 200, body: '{"id":"42"}' });
    expect(server.requests[0]?.body).toEqual(expectedSpoolPayload(0));
  });

  it("returns raw text for error responses", async () => {
    server.replies["/api/filaments-config"] = { status: 500, body: "boom" };

    expect(await client.setCustomFilamentsCsv("a,b")).toEqual({ status: 500, body: "boom" });
    expect(server.requests[0]?.body).toEqual({ custom_filaments: "a,b" });
  });
});
