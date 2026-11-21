// ABOUTME: Tests for the 3DFilamentProfiles monthly call ledger: server headers, estimates, month rollover, accounts.
// ABOUTME: The quota resets at 00:00 UTC on the 1st; 401 and 402 responses don't count toward it.

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  afterResponse,
  currentQuota,
  QuotaLedger,
  type QuotaState,
  quotaBlocks,
  quotaMonth,
  quotaReset,
} from "../src/apiQuota.js";

const NOV = new Date("2026-11-15T13:00:00Z");
const ACCOUNT = "acct1";

function headers(limit: number, remaining: number): Headers {
  return new Headers({
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": String(remaining),
  });
}

const known: QuotaState = {
  month: "2026-11",
  account: ACCOUNT,
  limit: 1000,
  remaining: 982,
  exact: true,
  updatedAt: "2026-11-15T12:00:00.000Z",
};

describe("quota months", () => {
  it("counts months in UTC", () => {
    expect(quotaMonth(new Date("2026-11-30T23:59:59Z"))).toBe("2026-11");
    expect(quotaMonth(new Date("2026-12-01T00:00:00Z"))).toBe("2026-12");
  });

  it("resets at 00:00 UTC on the first of the next month", () => {
    expect(quotaReset(NOV).toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(quotaReset(new Date("2026-12-31T22:00:00Z")).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });
});

describe("currentQuota", () => {
  it("knows nothing before the first response", () => {
    expect(currentQuota(null, ACCOUNT, NOV)).toEqual({
      month: "2026-11",
      account: ACCOUNT,
      limit: null,
      remaining: null,
      exact: false,
      updatedAt: null,
    });
  });

  it("keeps this month's numbers", () => {
    expect(currentQuota(known, ACCOUNT, NOV)).toEqual(known);
  });

  it("starts a new month with the whole limit, as an estimate", () => {
    expect(currentQuota(known, ACCOUNT, new Date("2026-12-01T00:00:01Z"))).toMatchObject({
      month: "2026-12",
      limit: 1000,
      remaining: 1000,
      exact: false,
    });
  });

  it("forgets another account's numbers", () => {
    expect(currentQuota(known, "acct2", NOV)).toMatchObject({
      account: "acct2",
      limit: null,
      remaining: null,
    });
  });
});

describe("afterResponse", () => {
  it("takes the server's numbers whenever it sends them", () => {
    expect(afterResponse(known, { status: 200, headers: headers(1000, 950) }, NOV)).toMatchObject({
      limit: 1000,
      remaining: 950,
      exact: true,
      updatedAt: NOV.toISOString(),
    });
  });

  it("takes them from an error response too", () => {
    expect(afterResponse(known, { status: 404, headers: headers(1000, 981) }, NOV)).toMatchObject({
      remaining: 981,
      exact: true,
    });
  });

  it("leaves the count alone for 401 and 402, which don't count", () => {
    for (const status of [401, 402])
      expect(afterResponse(known, { status, headers: new Headers() }, NOV)).toEqual(known);
  });

  it("knows the quota is used up on 429", () => {
    expect(afterResponse(known, { status: 429, headers: new Headers() }, NOV)).toMatchObject({
      remaining: 0,
      exact: true,
    });
  });

  it("counts one call when a response has no numbers, or there was no response", () => {
    expect(afterResponse(known, { status: 500, headers: new Headers() }, NOV)).toMatchObject({
      remaining: 981,
      exact: false,
    });
    expect(afterResponse(known, null, NOV)).toMatchObject({ remaining: 981, exact: false });
    expect(afterResponse({ ...known, remaining: 0 }, null, NOV)).toMatchObject({ remaining: 0 });
  });

  it("can't estimate from nothing", () => {
    const blank = currentQuota(null, ACCOUNT, NOV);
    expect(afterResponse(blank, null, NOV)).toMatchObject({ remaining: null });
  });

  it("ignores headers that aren't whole numbers", () => {
    const junk = new Headers({ "X-RateLimit-Limit": "lots", "X-RateLimit-Remaining": "-3" });
    expect(afterResponse(known, { status: 200, headers: junk }, NOV)).toMatchObject({
      remaining: 981,
      exact: false,
    });
  });
});

describe("quotaBlocks", () => {
  it("allows calls when the count is unknown or high enough", () => {
    expect(quotaBlocks(currentQuota(null, ACCOUNT, NOV), 5, NOV)).toBeNull();
    expect(quotaBlocks(known, 982, NOV)).toBeNull();
  });

  it("blocks calls the server said aren't left, naming the reset", () => {
    expect(quotaBlocks({ ...known, remaining: 3 }, 5, NOV)).toBe(
      "this needs 5 3DFilamentProfiles API calls, but only 3 are left until 2026-12-01 00:00 UTC",
    );
    expect(quotaBlocks({ ...known, remaining: 0, updatedAt: NOV.toISOString() }, 1, NOV)).toBe(
      "the monthly 3DFilamentProfiles API quota is used up until 2026-12-01 00:00 UTC",
    );
  });

  it("lets one call through to check again once a used-up quota is an hour old", () => {
    const usedUp = { ...known, remaining: 0, updatedAt: "2026-11-15T12:00:00.000Z" };
    expect(quotaBlocks(usedUp, 1, new Date("2026-11-15T12:59:59Z"))).toMatch(/used up/);
    // A burst limit or a plan upgrade would otherwise lock every command out until the 1st.
    expect(quotaBlocks(usedUp, 1, new Date("2026-11-15T13:00:00Z"))).toBeNull();
    // Numbers above 0 keep blocking, so the month-end fill's reserve holds however long ago they came.
    expect(
      quotaBlocks({ ...known, remaining: 3, updatedAt: "2026-11-01T00:00:00.000Z" }, 5, NOV),
    ).toMatch(/only 3 are left/);
  });

  it("never blocks on an estimate, which the server corrects on the next call", () => {
    expect(quotaBlocks({ ...known, remaining: 0, exact: false }, 1, NOV)).toBeNull();
  });

  it("says call for one call", () => {
    expect(quotaBlocks({ ...known, remaining: 100 }, 1, NOV, 100)).toBe(
      "this needs 1 3DFilamentProfiles API call, but only 100 are left until 2026-12-01 00:00 UTC and 100 are kept in reserve",
    );
  });

  it("keeps a reserve when asked", () => {
    expect(quotaBlocks({ ...known, remaining: 30 }, 5, NOV, 25)).toBeNull();
    expect(quotaBlocks({ ...known, remaining: 30 }, 6, NOV, 25)).toBe(
      "this needs 6 3DFilamentProfiles API calls, but only 30 are left until 2026-12-01 00:00 UTC and 25 are kept in reserve",
    );
  });
});

describe("QuotaLedger", () => {
  async function ledgerPath(): Promise<string> {
    return join(await mkdtemp(join(tmpdir(), "bh-quota-")), "nested", "3dfp-quota.json");
  }

  it("saves what each response says and reads it back", async () => {
    const path = await ledgerPath();
    const ledger = new QuotaLedger(path, ACCOUNT, () => NOV);
    await ledger.record({ status: 200, headers: headers(1000, 990) });
    expect(JSON.parse(await readFile(path, "utf-8"))).toMatchObject({
      month: "2026-11",
      account: ACCOUNT,
      limit: 1000,
      remaining: 990,
      exact: true,
    });
    expect(await new QuotaLedger(path, ACCOUNT, () => NOV).current()).toMatchObject({
      remaining: 990,
    });
  });

  it("keeps every record when several calls finish at once", async () => {
    const path = await ledgerPath();
    const ledger = new QuotaLedger(path, ACCOUNT, () => NOV);
    await ledger.record({ status: 200, headers: headers(1000, 100) });
    await Promise.all(Array.from({ length: 5 }, () => ledger.record(null)));
    expect(await ledger.current()).toMatchObject({ remaining: 95 });
  });

  it("never fails a record when other processes write the same file at once", async () => {
    const path = await ledgerPath();
    await new QuotaLedger(path, ACCOUNT, () => NOV).record({
      status: 200,
      headers: headers(1000, 500),
    });
    // One ledger per process: their queues don't know about each other.
    const ledgers = Array.from({ length: 50 }, () => new QuotaLedger(path, ACCOUNT, () => NOV));
    const results = await Promise.allSettled(
      ledgers.map((ledger) => ledger.record({ status: 200, headers: headers(1000, 499) })),
    );
    expect(results.filter((result) => result.status === "rejected")).toEqual([]);
    expect(await ledgers[0]?.current()).toMatchObject({ remaining: 499, exact: true });
  });

  it("starts over from a damaged file", async () => {
    const path = await ledgerPath();
    const ledger = new QuotaLedger(path, ACCOUNT, () => NOV);
    await ledger.record(null);
    await writeFile(path, "{not json", "utf-8");
    expect(await ledger.current()).toMatchObject({ limit: null, remaining: null });
  });
});
