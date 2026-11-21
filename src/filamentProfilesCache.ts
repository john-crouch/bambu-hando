// ABOUTME: Caches the 3DFilamentProfiles spool list for an hour (the API asks for no more than hourly polling).
// ABOUTME: One cache per account, told apart by a fingerprint of the key that never contains it.

import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { writeAtomic } from "./atomicWrite.js";
import type { FilamentProfilesClient, TdfpSpool } from "./filamentProfiles.js";
import { cacheDir } from "./paths.js";

export const SPOOLS_MAX_AGE_MS = 60 * 60_000;

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
}

export interface SpoolsCacheOptions {
  account: string;
  path?: string;
  /** Fetch even when the cache is fresh. */
  refresh?: boolean;
  maxAgeMs?: number;
  now?: () => Date;
  /** Runs only when the list is about to be fetched (one call), so a caller can keep a reserve; throwing stops it. */
  beforeFetch?: () => Promise<void>;
}

async function readCache(
  path: string,
  account: string,
): Promise<{ spools: TdfpSpool[]; fetchedAt: Date } | null> {
  try {
    const saved = JSON.parse(await readFile(path, "utf-8")) as {
      account?: unknown;
      fetchedAt?: unknown;
      spools?: unknown;
    };
    const fetchedAt = new Date(String(saved.fetchedAt));
    if (
      saved.account !== account ||
      Number.isNaN(fetchedAt.getTime()) ||
      !Array.isArray(saved.spools)
    )
      return null;
    return { spools: saved.spools as TdfpSpool[], fetchedAt };
  } catch {
    return null;
  }
}

/** The account's spools: from the cache while it's younger than maxAgeMs, else one API call. */
export async function mySpools(
  client: FilamentProfilesClient,
  options: SpoolsCacheOptions,
): Promise<CachedSpools> {
  const path = options.path ?? spoolsCachePath();
  const now = (options.now ?? (() => new Date()))();
  if (!options.refresh) {
    const cached = await readCache(path, options.account);
    const age = cached ? now.getTime() - cached.fetchedAt.getTime() : -1;
    // A cache dated in the future (clock changed) is as good as none.
    if (cached && age >= 0 && age < (options.maxAgeMs ?? SPOOLS_MAX_AGE_MS))
      return { ...cached, fromCache: true };
  }
  await options.beforeFetch?.();
  const spools = await client.listSpools();
  const saved = { account: options.account, fetchedAt: now.toISOString(), spools };
  await writeAtomic(path, `${JSON.stringify(saved, null, 2)}\n`, { mode: 0o600 });
  return { spools, fetchedAt: now, fromCache: false };
}

/** Drops the cached list, so the next read fetches what a write just changed. */
export async function forgetSpools(path: string = spoolsCachePath()): Promise<void> {
  await rm(path, { force: true });
}
