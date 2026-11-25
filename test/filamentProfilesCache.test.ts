// ABOUTME: Tests for the cached 3DFilamentProfiles spool list: an hour's reuse, changes-only refreshes, and one cache per account.
// ABOUTME: Each spool list read costs an API call, so the cache decides how often that happens.

import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { QuotaLedger } from "../src/apiQuota.js";
import { FilamentProfilesClient } from "../src/filamentProfiles.js";
import {
  accountId,
  FULL_LIST_EVERY_MS,
  forgetSpools,
  mySpools,
} from "../src/filamentProfilesCache.js";
import {
  type FilamentProfilesServer,
  serverSpool,
  startFilamentProfilesServer,
  TEST_API_KEY,
} from "./filamentProfilesServer.js";

const T0 = new Date("2026-11-15T13:00:00Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

describe("accountId", () => {
  it("is a short fingerprint that never contains the key", () => {
    expect(accountId(TEST_API_KEY)).toMatch(/^[0-9a-f]{16}$/);
    expect(accountId(TEST_API_KEY)).toBe(accountId(TEST_API_KEY));
    expect(accountId("3dfp_other")).not.toBe(accountId(TEST_API_KEY));
  });
});

describe("mySpools", () => {
  let server: FilamentProfilesServer;
  let client: FilamentProfilesClient;
  let path: string;
  const account = accountId(TEST_API_KEY);

  beforeEach(async () => {
    server = await startFilamentProfilesServer();
    server.spools = [serverSpool()];
    const dir = await mkdtemp(join(tmpdir(), "bh-3dfp-cache-"));
    path = join(dir, "3dfp", "spools.json");
    client = new FilamentProfilesClient({
      key: TEST_API_KEY,
      base: server.url,
      ledger: new QuotaLedger(join(dir, "quota.json"), account),
    });
  });

  afterEach(async () => {
    await server.close();
  });

  it("fetches the list when nothing is cached, and keeps it private", async () => {
    const result = await mySpools(client, { account, path, now: () => T0 });
    expect(result).toMatchObject({ fromCache: false, fetchedAt: T0 });
    expect(result.spools.map((s) => s.shortCode)).toEqual(["ABC123"]);
    expect(JSON.parse(await readFile(path, "utf-8"))).toMatchObject({
      account,
      fetchedAt: T0.toISOString(),
      fullAt: T0.toISOString(),
      asOf: expect.any(String),
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("reuses the list for an hour without a call", async () => {
    await mySpools(client, { account, path, now: () => T0 });
    server.spools = [];
    const cached = await mySpools(client, { account, path, now: () => minutes(59) });
    expect(cached).toMatchObject({ fromCache: true, fetchedAt: T0 });
    expect(cached.spools).toHaveLength(1);
    expect(server.requests).toHaveLength(1);
  });

  it("asks for the changes once the list is an hour old, and for the full list on refresh", async () => {
    await mySpools(client, { account, path, now: () => T0 });
    const { asOf } = JSON.parse(await readFile(path, "utf-8"));
    expect(await mySpools(client, { account, path, now: () => minutes(60) })).toMatchObject({
      fromCache: false,
      changesOnly: true,
    });
    expect(server.requests[1]?.query).toEqual({ updated_since: asOf });
    expect(
      await mySpools(client, { account, path, refresh: true, now: () => minutes(61) }),
    ).toMatchObject({ fromCache: false, changesOnly: false });
    expect(server.requests[2]?.query).toEqual({});
    expect(server.requests).toHaveLength(3);
  });

  it("merges the changes into the saved list: changed, new and deleted spools", async () => {
    server.spools = [serverSpool(), serverSpool({ short_code: "XYZ789", color: "Black" })];
    await mySpools(client, { account, path, now: () => T0 });
    const later = new Date(Date.now() + 1000).toISOString();
    server.spools = [
      serverSpool({ remaining_grams: 100, updated_at: later }),
      serverSpool({ short_code: "NEW555", color: "White", updated_at: later }),
    ];
    server.deleted = [{ short_code: "XYZ789", deleted_at: later }];
    const merged = await mySpools(client, { account, path, now: () => minutes(61) });
    expect(merged.spools.map((s) => [s.shortCode, s.remainingGrams])).toEqual([
      ["ABC123", 100],
      ["NEW555", 740],
    ]);
    const saved = JSON.parse(await readFile(path, "utf-8"));
    expect(saved).toMatchObject({ fetchedAt: minutes(61).toISOString(), fullAt: T0.toISOString() });
    expect(saved.spools).toHaveLength(2);
    // Nothing changed since: the next poll keeps the list as it is.
    const quiet = await mySpools(client, { account, path, now: () => minutes(122) });
    expect(quiet.spools.map((s) => s.shortCode)).toEqual(["ABC123", "NEW555"]);
  });

  it("fetches the full list again once a day, for changes the changes leave out", async () => {
    await mySpools(client, { account, path, now: () => T0 });
    const dayLater = new Date(T0.getTime() + FULL_LIST_EVERY_MS);
    expect(await mySpools(client, { account, path, now: () => dayLater })).toMatchObject({
      changesOnly: false,
    });
    expect(server.requests[1]?.query).toEqual({});
  });

  it("fetches the full list when the API gave no time to ask for changes since", async () => {
    server.replies["GET /api/v1/my/spools"] = { status: 200, body: { data: [] } };
    await mySpools(client, { account, path, now: () => T0 });
    delete server.replies["GET /api/v1/my/spools"];
    await mySpools(client, { account, path, now: () => minutes(61) });
    expect(server.requests[1]?.query).toEqual({});
  });

  it("asks for the changes after the cache is forgotten, which a write to the spools does", async () => {
    await mySpools(client, { account, path, now: () => T0 });
    await forgetSpools(path);
    expect(await mySpools(client, { account, path, now: () => minutes(1) })).toMatchObject({
      fromCache: false,
      changesOnly: true,
    });
    await writeFile(path, "{oops", "utf-8");
    await forgetSpools(path);
    await forgetSpools(path);
  });

  it("takes a shorter or longer reuse window", async () => {
    await mySpools(client, { account, path, now: () => T0 });
    expect(
      await mySpools(client, { account, path, maxAgeMs: 5 * 60_000, now: () => minutes(6) }),
    ).toMatchObject({ fromCache: false });
  });

  it("ignores another account's list", async () => {
    await mySpools(client, { account: "someone-else", path, now: () => T0 });
    expect(await mySpools(client, { account, path, now: () => minutes(1) })).toMatchObject({
      fromCache: false,
    });
  });

  it("ignores a damaged cache, or one dated in the future", async () => {
    await mySpools(client, { account, path, now: () => T0 });
    await writeFile(path, "{oops", "utf-8");
    expect(await mySpools(client, { account, path, now: () => minutes(1) })).toMatchObject({
      fromCache: false,
    });
    expect(await mySpools(client, { account, path, now: () => minutes(-30) })).toMatchObject({
      fromCache: false,
    });
  });
});
