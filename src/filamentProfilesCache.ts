// ABOUTME: Caches the 3DFilamentProfiles spool list for an hour (the API asks for no more than hourly polling), then asks
// ABOUTME: only for what changed since, with a full list once a day. One cache per account, told apart by a key fingerprint.

import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { writeAtomic } from "./atomicWrite.js";
import type { FilamentProfilesClient, TdfpSpool } from "./filamentProfiles.js";
import { cacheDir } from "./paths.js";

export const SPOOLS_MAX_AGE_MS = 60 * 60_000;
/**
 * How old the last full list may get before a refresh fetches the whole list again instead of the changes: the
 * changes follow the spools themselves, not edits to their filaments' catalog entries (a renamed color).
 */
export const FULL_LIST_EVERY_MS = 24 * 60 * 60_000;

/** 16 hex characters of the key's SHA-256: tells accounts apart without keeping the key. */
export function accountId(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export function spoolsCachePath(): string {
  return join(cacheDir(), "3dfp", "spools.json");
}

export interface CachedSpools {
  spools: TdfpSpool[];
  fetchedAt: Date;
  fromCache: boolean;
  /** The call asked only for the changes since the last list, merged into the saved one. */
  changesOnly: boolean;
}

export interface SpoolsCacheOptions {
  account: string;
  path?: string;
  /** Fetch the full list, even when the cache is fresh. */
  refresh?: boolean;
  maxAgeMs?: number;
  now?: () => Date;
  /** Runs only when the list is about to be fetched (one call), so a caller can keep a reserve; throwing stops it. */
  beforeFetch?: () => Promise<void>;
}

interface SavedSpools {
  spools: TdfpSpool[];
  fetchedAt: Date;
  /** When the whole list was last fetched; null for a cache written before changes were asked for. */
  fullAt: Date | null;
  /** The API's time to ask for changes since; null when it sent none. */
  asOf: string | null;
  /** Forgotten after a write: the next read asks the API, but the list can still take the changes. */
  stale: boolean;
}

const dateOf = (value: unknown): Date | null => {
  const date = new Date(String(value));
  return typeof value === "string" && !Number.isNaN(date.getTime()) ? date : null;
};

async function readCache(path: string, account: string): Promise<SavedSpools | null> {
  try {
    const saved = JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
    const fetchedAt = dateOf(saved.fetchedAt);
    if (saved.account !== account || !fetchedAt || !Array.isArray(saved.spools)) return null;
    return {
      spools: saved.spools as TdfpSpool[],
      fetchedAt,
      fullAt: dateOf(saved.fullAt),
      asOf: typeof saved.asOf === "string" ? saved.asOf : null,
      stale: saved.stale === true,
    };
  } catch {
    return null;
  }
}

async function writeCache(path: string, account: string, saved: SavedSpools): Promise<void> {
  const body = {
    account,
    fetchedAt: saved.fetchedAt.toISOString(),
    fullAt: saved.fullAt?.toISOString() ?? null,
    asOf: saved.asOf,
    ...(saved.stale ? { stale: true } : {}),
    spools: saved.spools,
  };
  await writeAtomic(path, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
}

/** The saved list with the changes applied: changed spools replaced in place, new ones last, deleted ones gone. */
function merged(spools: TdfpSpool[], changed: TdfpSpool[], deleted: string[]): TdfpSpool[] {
  const byCode = new Map(changed.map((spool) => [spool.shortCode, spool]));
  const gone = new Set(deleted);
  const kept = spools
    .filter((spool) => !gone.has(spool.shortCode))
    .map((spool) => byCode.get(spool.shortCode) ?? spool);
  const known = new Set(spools.map((spool) => spool.shortCode));
  return [
    ...kept,
    ...changed.filter((spool) => !known.has(spool.shortCode) && !gone.has(spool.shortCode)),
  ];
}

/**
 * The account's spools: from the cache while it's younger than maxAgeMs, else one API call. That call asks only for
 * the changes since the saved list (merged into it) while the last full list is under FULL_LIST_EVERY_MS old;
 * otherwise, and on refresh, it fetches the whole list.
 */
export async function mySpools(
  client: FilamentProfilesClient,
  options: SpoolsCacheOptions,
): Promise<CachedSpools> {
  const path = options.path ?? spoolsCachePath();
  const now = (options.now ?? (() => new Date()))();
  // A time dated in the future (clock changed) is as good as none.
  const age = (date: Date | null | undefined) => (date ? now.getTime() - date.getTime() : -1);
  const cached = options.refresh ? null : await readCache(path, options.account);
  if (cached && !cached.stale) {
    const fetched = age(cached.fetchedAt);
    if (fetched >= 0 && fetched < (options.maxAgeMs ?? SPOOLS_MAX_AGE_MS))
      return {
        spools: cached.spools,
        fetchedAt: cached.fetchedAt,
        fromCache: true,
        changesOnly: false,
      };
  }
  await options.beforeFetch?.();
  const full = age(cached?.fullAt);
  if (cached?.asOf && cached.fullAt && full >= 0 && full < FULL_LIST_EVERY_MS) {
    const changes = await client.listSpools(cached.asOf);
    const spools = merged(cached.spools, changes.spools, changes.deleted);
    await writeCache(path, options.account, {
      spools,
      fetchedAt: now,
      fullAt: cached.fullAt,
      asOf: changes.asOf,
      stale: false,
    });
    return { spools, fetchedAt: now, fromCache: false, changesOnly: true };
  }
  const list = await client.listSpools();
  await writeCache(path, options.account, {
    spools: list.spools,
    fetchedAt: now,
    fullAt: now,
    asOf: list.asOf,
    stale: false,
  });
  return { spools: list.spools, fetchedAt: now, fromCache: false, changesOnly: false };
}

/**
 * Marks the cached list stale, so the next read asks the API for what a write just changed (the changes since,
 * when the list can take them). A cache that can't be read is removed.
 */
export async function forgetSpools(path: string = spoolsCachePath()): Promise<void> {
  try {
    const saved = JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      await writeAtomic(path, `${JSON.stringify({ ...saved, stale: true }, null, 2)}\n`, {
        mode: 0o600,
      });
      return;
    }
  } catch {
    // Missing or damaged: removed below.
  }
  await rm(path, { force: true });
}
