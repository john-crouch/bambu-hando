// ABOUTME: Tests for the cached 3DFilamentProfiles spool list: an hour's reuse, refresh, and one cache per account.
// ABOUTME: Each spool list read costs an API call, so the cache decides how often that happens.

import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { QuotaLedger } from "../src/apiQuota.js";
import { FilamentProfilesClient } from "../src/filamentProfiles.js";
import { accountId, mySpools } from "../src/filamentProfilesCache.js";
import { type FilamentProfilesServer, serverSpool, startFilamentProfilesServer, TEST_API_KEY } from "./filamentProfilesServer.js";

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
    client = new FilamentProfilesClient({ key: TEST_API_KEY, base: server.url, ledger: new QuotaLedger(join(dir, "quota.json"), account) });
  });

  afterEach(async () => {
    await server.close();
  });

  it("fetches the list when nothing is cached, and keeps it private", async () => {
    const result = await mySpools(client, { account, path, now: () => T0 });
    expect(result).toMatchObject({ fromCache: false, fetchedAt: T0 });
    expect(result.spools.map((s) => s.shortCode)).toEqual(["ABC123"]);
    expect(JSON.parse(await readFile(path, "utf-8"))).toMatchObject({ account, fetchedAt: T0.toISOString() });
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

  it("fetches again once the list is an hour old, or on refresh", async () => {
    await mySpools(client, { account, path, now: () => T0 });
    expect(await mySpools(client, { account, path, now: () => minutes(60) })).toMatchObject({ fromCache: false });
    expect(await mySpools(client, { account, path, refresh: true, now: () => minutes(61) })).toMatchObject({ fromCache: false });
    expect(server.requests).toHaveLength(3);
  });

  it("takes a shorter or longer reuse window", async () => {
    await mySpools(client, { account, path, now: () => T0 });
    expect(await mySpools(client, { account, path, maxAgeMs: 5 * 60_000, now: () => minutes(6) })).toMatchObject({ fromCache: false });
  });

  it("ignores another account's list", async () => {
    await mySpools(client, { account: "someone-else", path, now: () => T0 });
    expect(await mySpools(client, { account, path, now: () => minutes(1) })).toMatchObject({ fromCache: false });
  });

  it("ignores a damaged cache, or one dated in the future", async () => {
    await mySpools(client, { account, path, now: () => T0 });
    await writeFile(path, "{oops", "utf-8");
    expect(await mySpools(client, { account, path, now: () => minutes(1) })).toMatchObject({ fromCache: false });
    expect(await mySpools(client, { account, path, now: () => minutes(-30) })).toMatchObject({ fromCache: false });
  });
});
