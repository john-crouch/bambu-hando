// ABOUTME: Tests SpoolEase CSV and spool payload generation against Python reference output.
// ABOUTME: Also covers the encrypted HTTP client against a local SpoolEase protocol server.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildCustomFilamentsCsv, customFilamentCode, SpoolEaseClient, spoolPayload } from "../src/spoolease.js";
import { parity, parityProfiles, profileAt } from "./parity.js";
import { startSpoolEaseServer, type SpoolEaseServer, TEST_SECURITY_KEY } from "./spooleaseServer.js";

describe("payload builders", () => {
  it("builds the same custom filaments CSV as Python", () => {
    expect(buildCustomFilamentsCsv(parityProfiles)).toBe(parity.custom_filaments_csv);
  });

  it("derives fallback codes from the 1-based index in hex", () => {
    expect(customFilamentCode(profileAt(1), 255)).toBe("P0000FF");
    expect(customFilamentCode(profileAt(0), 255)).toBe("PABC1234");
  });

  it.each(parityProfiles.map((p, i) => [p.name, i] as const))("builds the same spool payload as Python for %s", (_name, index) => {
    expect(spoolPayload(profileAt(index))).toEqual(parity.spool_payloads[index]);
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
    expect(server.requests[0]?.body).toEqual(parity.spool_payloads[0]);
  });

  it("returns raw text for error responses", async () => {
    server.replies["/api/filaments-config"] = { status: 500, body: "boom" };

    expect(await client.setCustomFilamentsCsv("a,b")).toEqual({ status: 500, body: "boom" });
    expect(server.requests[0]?.body).toEqual({ custom_filaments: "a,b" });
  });
});
