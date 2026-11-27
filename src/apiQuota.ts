// ABOUTME: Keeps count of the 3DFilamentProfiles API's monthly quota, so a run never starts what it can't finish.
// ABOUTME: Trusts the server's X-RateLimit headers when sent, estimates otherwise; the month rolls over at 00:00 UTC on the 1st.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { writeAtomic } from "./atomicWrite.js";
import { configDir } from "./paths.js";

export interface QuotaState {
  /** The UTC month these numbers belong to, "YYYY-MM". */
  month: string;
  /** Fingerprint of the key's account (accountId), so another key's numbers aren't used. */
  account: string;
  limit: number | null;
  remaining: number | null;
  /** True when remaining is what the server last said; false when it's our estimate. */
  exact: boolean;
  /** When the server last sent numbers, ISO 8601. */
  updatedAt: string | null;
}

/** What afterResponse needs of a response; null when there was none (the server was unreachable). */
export interface QuotaResponse {
  status: number;
  headers: Headers;
}

export class QuotaError extends Error {}

export function quotaPath(): string {
  return join(configDir(), "3dfp-quota.json");
}

export function quotaMonth(now: Date): string {
  return now.toISOString().slice(0, 7);
}

export function quotaReset(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/** "2026-12-01 00:00 UTC". */
export function utcMinute(time: Date): string {
  return `${time.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** The saved state as of `now`: blank for another account, the whole limit (estimated) in a new month. */
export function currentQuota(saved: QuotaState | null, account: string, now: Date): QuotaState {
  const month = quotaMonth(now);
  if (!saved || saved.account !== account)
    return { month, account, limit: null, remaining: null, exact: false, updatedAt: null };
  if (saved.month !== month) return { ...saved, month, remaining: saved.limit, exact: false };
  return saved;
}

function headerCount(headers: Headers, name: string): number | null {
  const value = headers.get(name);
  return value !== null && /^\d+$/.test(value.trim()) ? Number(value) : null;
}

export function afterResponse(
  state: QuotaState,
  response: QuotaResponse | null,
  now: Date,
): QuotaState {
  if (response) {
    const limit = headerCount(response.headers, "X-RateLimit-Limit");
    const remaining = headerCount(response.headers, "X-RateLimit-Remaining");
    if (limit !== null && remaining !== null)
      return { ...state, limit, remaining, exact: true, updatedAt: now.toISOString() };
    // Requests rejected with 401 or 402 don't count toward the quota.
    if (response.status === 401 || response.status === 402) return state;
    if (response.status === 429)
      return { ...state, remaining: 0, exact: true, updatedAt: now.toISOString() };
  }
  // No numbers (or no response): assume the call counted, since a request that reached the server does.
  return {
    ...state,
    remaining: state.remaining === null ? null : Math.max(0, state.remaining - 1),
    exact: false,
  };
}

/** How long a used-up quota blocks before one call may check again. */
export const USED_UP_RECHECK_MS = 60 * 60 * 1000;

/**
 * Why `calls` more calls can't be made, or null when they can; only the server's own numbers block. A used-up quota
 * (0, from a 429 or the headers) stops blocking after USED_UP_RECHECK_MS, since nothing else can bring fresh numbers:
 * a burst limit or a mid-month plan upgrade would otherwise lock every command out until the 1st. If it's still used
 * up, the server answers 429 again. Numbers above 0 never expire, so a reserve holds.
 */
export function quotaBlocks(
  state: QuotaState,
  calls: number,
  now: Date,
  reserve = 0,
): string | null {
  if (!state.exact || state.remaining === null || state.remaining - calls >= reserve) return null;
  const checkedAt = state.updatedAt === null ? Number.NaN : Date.parse(state.updatedAt);
  if (state.remaining === 0 && now.getTime() - checkedAt >= USED_UP_RECHECK_MS) return null;
  const until = utcMinute(quotaReset(now));
  if (state.remaining === 0)
    return `the monthly 3DFilamentProfiles API quota is used up until ${until}`;
  const kept = reserve > 0 ? ` and ${reserve} are kept in reserve` : "";
  return `this needs ${calls} 3DFilamentProfiles API call${calls === 1 ? "" : "s"}, but only ${state.remaining} are left until ${until}${kept}`;
}

function parseState(text: string): QuotaState | null {
  try {
    const saved = JSON.parse(text) as Record<string, unknown>;
    const count = (value: unknown) =>
      typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
    if (typeof saved.month !== "string" || typeof saved.account !== "string") return null;
    return {
      month: saved.month,
      account: saved.account,
      limit: count(saved.limit),
      remaining: count(saved.remaining),
      exact: saved.exact === true,
      updatedAt: typeof saved.updatedAt === "string" ? saved.updatedAt : null,
    };
  } catch {
    return null;
  }
}

/** The quota file for one account; records are applied one at a time, so concurrent calls all count. */
export class QuotaLedger {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly account: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async current(): Promise<QuotaState> {
    let saved: QuotaState | null = null;
    try {
      saved = parseState(await readFile(this.path, "utf-8"));
    } catch {
      // No file yet.
    }
    return currentQuota(saved, this.account, this.now());
  }

  /** Throws QuotaError when the server has said `calls` more calls aren't left (beyond `reserve`). */
  async ensure(calls: number, reserve = 0): Promise<void> {
    const reason = quotaBlocks(await this.current(), calls, this.now(), reserve);
    if (reason) throw new QuotaError(reason);
  }

  record(response: QuotaResponse | null): Promise<QuotaState> {
    const next = this.queue.then(async () => {
      const state = afterResponse(await this.current(), response, this.now());
      await writeAtomic(this.path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
      return state;
    });
    this.queue = next.catch(() => undefined);
    return next;
  }
}
