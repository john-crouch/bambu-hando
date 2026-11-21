// ABOUTME: Client for the 3DFilamentProfiles v1 API (https://3dfilamentprofiles.com/api/v1): spools and filaments.
// ABOUTME: Sends the key only to that origin (or loopback, for tests), never follows redirects, and counts every call.

import { QuotaError, type QuotaLedger, type QuotaResponse } from "./apiQuota.js";
import { errorMessage } from "./errors.js";

export const FILAMENT_PROFILES_API = "https://3dfilamentprofiles.com/api/v1";

const REQUEST_TIMEOUT_MS = 20_000;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** The API base URL: the real one, or FILAMENTPROFILES_API_URL when that points at this machine. */
export function apiBase(env: Record<string, string | undefined> = process.env): string {
  const override = env.FILAMENTPROFILES_API_URL?.trim();
  if (!override) return FILAMENT_PROFILES_API;
  let url: URL;
  try {
    url = new URL(override);
  } catch {
    url = new URL("invalid:");
  }
  const origin = url.protocol === "http:" || url.protocol === "https:" ? url.hostname : "";
  if (!LOOPBACK.has(origin)) {
    throw new Error(
      `refusing to send the 3DFilamentProfiles API key to FILAMENTPROFILES_API_URL: only ${FILAMENT_PROFILES_API} or this machine (for tests) get it`,
    );
  }
  return override.replace(/\/+$/, "");
}

export class FilamentProfilesError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
    readonly code: string | null = null,
  ) {
    super(message);
  }
}

/** A spool in the account. The list leaves out the Bambu IDs (undefined); a single spool's read has them. */
export interface TdfpSpool {
  shortCode: string;
  filamentId: number;
  brand: string;
  material: string;
  materialType: string | null;
  color: string;
  rgb: string | null;
  remainingGrams: number;
  /** Only the list has it: the spool's own, else the filament's. */
  emptySpoolWeight?: number | null;
  location: string | null;
  notes: string | null;
  updatedAt: string;
  url: string;
  bambuSpoolId?: string | null;
  bambuTagId?: string | null;
}

/** At most one of remainingGrams, usedGrams and usedMm; null clears location or an ID. */
export interface SpoolPatch {
  remainingGrams?: number;
  usedGrams?: number;
  usedMm?: number;
  location?: string | null;
  bambuSpoolId?: string | null;
  bambuTagId?: string | null;
}

export interface SpoolUpdate {
  shortCode: string;
  remainingGrams: number;
  deductedGrams: number;
  location: string;
  bambuSpoolId: string | null;
  bambuTagId: string | null;
}

export interface NewSpool {
  filamentId: number;
  /** Only create one when the account has no spool of this filament with grams left. */
  ifNotOwned?: boolean;
  remainingGrams?: number;
  notes?: string;
}

export type AddedSpool =
  | { created: true; spool: TdfpSpool }
  | { created: false; existing: string[] };

export interface FilamentFilters {
  q?: string | undefined;
  brand?: string | undefined;
  material?: string | undefined;
  type?: string;
  gtin?: string;
  page?: number;
  limit?: number;
}

export interface TdfpFilament {
  id: number;
  brandKey: string;
  brandName: string;
  materialKey: string;
  material: string;
  materialTypeKey: string | null;
  materialType: string | null;
  color: string;
  rgb: string | null;
  tdValue: number | null;
  discontinued: boolean;
  url: string;
}

/** Units as the API sends them: °C, density in mg/cm³, diameter in µm, weights in grams. Store prices are left out: they change daily. */
export interface TdfpFilamentDetail extends TdfpFilament {
  tempMin: number | null;
  tempMax: number | null;
  bedTempMin: number | null;
  bedTempMax: number | null;
  density: number | null;
  diameter: number | null;
  nominalWeight: number | null;
  spoolWeight: number | null;
  chamberTemp: number | null;
  dryTempMax: number | null;
  /** Hours. */
  dryTime: number | null;
  /** Community values. */
  flowRatio: number | null;
  kValue: number | null;
  /** mm³/s. */
  maxVolumetricSpeed: number | null;
  softeningTemp: number | null;
}

export interface FilamentPage {
  filaments: TdfpFilament[];
  page: number;
  limit: number;
  total: number;
  totalIsEstimate: boolean;
  /** A page shorter than the limit is the last one. */
  last: boolean;
}

type Json = Record<string, unknown>;

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const optStr = (value: unknown): string | null => (typeof value === "string" ? value : null);
const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
const optNum = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function spool(raw: Json): TdfpSpool {
  const parsed: TdfpSpool = {
    shortCode: str(raw.short_code),
    filamentId: num(raw.filament_id),
    brand: str(raw.brand ?? raw.brand_name),
    material: str(raw.material),
    materialType: optStr(raw.material_type),
    color: str(raw.color),
    rgb: optStr(raw.rgb),
    remainingGrams: num(raw.remaining_grams),
    location: optStr(raw.location),
    notes: optStr(raw.notes),
    updatedAt: str(raw.updated_at),
    url: str(raw.spool_url ?? raw.url),
  };
  if ("empty_spool_weight" in raw) parsed.emptySpoolWeight = optNum(raw.empty_spool_weight);
  if ("bambu_spool_id" in raw) parsed.bambuSpoolId = optStr(raw.bambu_spool_id);
  if ("bambu_tag_id" in raw) parsed.bambuTagId = optStr(raw.bambu_tag_id);
  return parsed;
}

function filament(raw: Json): TdfpFilament {
  return {
    id: num(raw.id),
    brandKey: str(raw.brand_key),
    brandName: str(raw.brand_name),
    materialKey: str(raw.material_key),
    material: str(raw.material),
    materialTypeKey: optStr(raw.material_type_key),
    materialType: optStr(raw.material_type),
    color: str(raw.color),
    rgb: optStr(raw.rgb),
    tdValue: optNum(raw.td_value),
    discontinued: raw.discontinued === true,
    url: str(raw.url),
  };
}

function invalid(message: string): FilamentProfilesError {
  return new FilamentProfilesError(`not sent to 3DFilamentProfiles: ${message}`);
}

const isInt = (value: number, min: number, max: number) =>
  Number.isInteger(value) && value >= min && value <= max;

// The API's documented bounds, checked here because a request it refuses still costs a call.
function patchBody(patch: SpoolPatch): Json {
  const weights = [patch.remainingGrams, patch.usedGrams, patch.usedMm].filter(
    (value) => value !== undefined,
  );
  if (weights.length > 1) throw invalid("send at most one of remainingGrams, usedGrams and usedMm");
  if (patch.remainingGrams !== undefined && !isInt(patch.remainingGrams, 0, 10_000))
    throw invalid("remainingGrams must be a whole number from 0 to 10000");
  if (patch.usedGrams !== undefined && !(patch.usedGrams > 0 && patch.usedGrams <= 10_000))
    throw invalid("usedGrams must be above 0 and at most 10000");
  if (patch.usedMm !== undefined && !(patch.usedMm > 0 && patch.usedMm <= 1_000_000))
    throw invalid("usedMm must be above 0 and at most 1000000");
  if (
    typeof patch.location === "string" &&
    (patch.location.trim() === "" || patch.location.length > 200)
  ) {
    throw invalid("location must be 1 to 200 characters, or null to clear it");
  }
  for (const id of [patch.bambuSpoolId, patch.bambuTagId])
    if (typeof id === "string" && id.length > 64)
      throw invalid("Bambu IDs are at most 64 characters");
  const body: Json = {};
  if (patch.remainingGrams !== undefined) body.remaining_grams = patch.remainingGrams;
  if (patch.usedGrams !== undefined) body.used_grams = patch.usedGrams;
  if (patch.usedMm !== undefined) body.used_mm = patch.usedMm;
  if (patch.location !== undefined) body.location = patch.location;
  if (patch.bambuSpoolId !== undefined) body.bambu_spool_id = patch.bambuSpoolId;
  if (patch.bambuTagId !== undefined) body.bambu_tag_id = patch.bambuTagId;
  if (Object.keys(body).length === 0) throw invalid("the update changes nothing");
  return body;
}

function filamentQuery(filters: FilamentFilters): URLSearchParams {
  if (filters.q !== undefined && filters.q.length > 100)
    throw invalid("q is at most 100 characters");
  if (filters.page !== undefined && !isInt(filters.page, 1, 20))
    throw invalid("page must be from 1 to 20");
  if (filters.limit !== undefined && !isInt(filters.limit, 1, 50))
    throw invalid("limit must be from 1 to 50");
  if (filters.gtin !== undefined) {
    if (!/^\d{8,14}$/.test(filters.gtin)) throw invalid("gtin must be 8 to 14 digits");
    if ((filters.page ?? 1) > 1) throw invalid("a gtin lookup has only one page");
  }
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(filters))
    if (value !== undefined) query.set(name, String(value));
  return query;
}

export interface FilamentProfilesOptions {
  key: string;
  ledger: QuotaLedger;
  base?: string;
  timeoutMs?: number;
}

export class FilamentProfilesClient {
  private readonly base: string;

  constructor(private readonly options: FilamentProfilesOptions) {
    this.base = options.base ?? apiBase();
  }

  /**
   * Notes a call in the quota file. A failed write mustn't replace the API's answer: the request already happened
   * (a PATCH that went through would look failed), and the next reply's quota headers set the count right again.
   */
  private async recordQuota(response: QuotaResponse | null): Promise<void> {
    try {
      await this.options.ledger.record(response);
    } catch {
      // Not counted; see above.
    }
  }

  private async request(method: string, path: string, body?: Json): Promise<Json> {
    await this.options.ledger.ensure(1);
    let resp: Response;
    try {
      resp = await fetch(`${this.base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.options.key}`,
          Accept: "application/json",
          "User-Agent": "bambu-hando",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        // A redirect could carry the key to another host: never follow one.
        redirect: "manual",
        signal: AbortSignal.timeout(this.options.timeoutMs ?? REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      await this.recordQuota(null);
      // fetch quotes a header value it refuses, and the key is one.
      const reason = errorMessage(err).replaceAll(this.options.key, "<API key>");
      throw new FilamentProfilesError(`can't reach 3DFilamentProfiles: ${reason}`);
    }
    await this.recordQuota({ status: resp.status, headers: resp.headers });
    const text = await resp.text();
    if (resp.status >= 300 && resp.status < 400) {
      throw new FilamentProfilesError(
        `3DFilamentProfiles answered with a redirect (HTTP ${resp.status}), which bambu-hando never follows`,
        resp.status,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    if (resp.ok) {
      if (parsed === null || typeof parsed !== "object")
        throw new FilamentProfilesError(
          `3DFilamentProfiles sent a reply that isn't JSON (HTTP ${resp.status})`,
          resp.status,
        );
      return parsed as Json;
    }
    const error = (parsed as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    const code = typeof error?.code === "string" ? error.code : null;
    if (resp.status === 401) {
      throw new FilamentProfilesError(
        "3DFilamentProfiles rejected the API key (missing, malformed or regenerated): run `bambu-hando key set 3dfp` with the current one",
        401,
        code,
      );
    }
    if (resp.status === 402)
      throw new FilamentProfilesError(
        "the 3DFilamentProfiles account has no active API access (subscription or Patreon lapsed?)",
        402,
        code,
      );
    if (resp.status === 429) {
      // The ledger now knows the quota is used up, and says until when.
      await this.options.ledger.ensure(1);
      throw new QuotaError(
        "the monthly 3DFilamentProfiles API quota is used up until the 1st of next month, 00:00 UTC",
      );
    }
    const message = typeof error?.message === "string" ? error.message : null;
    if (!message)
      throw new FilamentProfilesError(
        `3DFilamentProfiles answered HTTP ${resp.status}`,
        resp.status,
        code,
      );
    throw new FilamentProfilesError(
      `3DFilamentProfiles: ${message}${code ? ` (${code})` : ""}`,
      resp.status,
      code,
    );
  }

  /** Every spool in the account, in one call. */
  async listSpools(): Promise<TdfpSpool[]> {
    const reply = await this.request("GET", "/my/spools");
    if (!Array.isArray(reply.data))
      throw new FilamentProfilesError("3DFilamentProfiles sent a spool list without data");
    return reply.data.map((raw) => spool(raw as Json));
  }

  async getSpool(shortCode: string): Promise<TdfpSpool> {
    return spool(await this.request("GET", `/my/spools/${encodeURIComponent(shortCode)}`));
  }

  async updateSpool(shortCode: string, patch: SpoolPatch): Promise<SpoolUpdate> {
    const reply = await this.request(
      "PATCH",
      `/my/spools/${encodeURIComponent(shortCode)}`,
      patchBody(patch),
    );
    return {
      shortCode: str(reply.short_code),
      remainingGrams: num(reply.remaining_grams),
      deductedGrams: num(reply.deducted_grams),
      location: str(reply.location),
      bambuSpoolId: optStr(reply.bambu_spool_id),
      bambuTagId: optStr(reply.bambu_tag_id),
    };
  }

  async addSpool(request: NewSpool): Promise<AddedSpool> {
    if (request.remainingGrams !== undefined && !isInt(request.remainingGrams, 0, 10_000))
      throw invalid("remainingGrams must be a whole number from 0 to 10000");
    if (request.notes !== undefined && request.notes.length > 500)
      throw invalid("notes are at most 500 characters");
    const body: Json = { filament_id: request.filamentId };
    if (request.remainingGrams !== undefined) body.remaining_grams = request.remainingGrams;
    if (request.notes !== undefined) body.notes = request.notes;
    if (request.ifNotOwned !== undefined) body.if_not_owned = request.ifNotOwned;
    const reply = await this.request("POST", "/my/spools", body);
    if (reply.created === true) return { created: true, spool: spool(reply.spool as Json) };
    const existing = Array.isArray(reply.spools)
      ? reply.spools.map((raw) => str((raw as Json).short_code))
      : [];
    return { created: false, existing };
  }

  async listFilaments(filters: FilamentFilters = {}): Promise<FilamentPage> {
    const query = filamentQuery(filters).toString();
    const reply = await this.request("GET", `/filaments${query ? `?${query}` : ""}`);
    const filaments = Array.isArray(reply.data)
      ? reply.data.map((raw) => filament(raw as Json))
      : [];
    const limit = num(reply.limit);
    return {
      filaments,
      page: num(reply.page),
      limit,
      total: num(reply.total),
      totalIsEstimate: reply.total_is_estimate === true,
      last: filaments.length < limit,
    };
  }

  /** The id in the result is the surviving filament's when filaments were merged: keep that one. */
  async getFilament(id: number): Promise<TdfpFilamentDetail> {
    const raw = await this.request("GET", `/filaments/${encodeURIComponent(String(id))}`);
    return {
      ...filament(raw),
      tempMin: optNum(raw.temp_min),
      tempMax: optNum(raw.temp_max),
      bedTempMin: optNum(raw.bed_temp_min),
      bedTempMax: optNum(raw.bed_temp_max),
      density: optNum(raw.density),
      diameter: optNum(raw.diameter),
      nominalWeight: optNum(raw.nominal_weight),
      spoolWeight: optNum(raw.spool_weight),
      chamberTemp: optNum(raw.chamber_temp),
      dryTempMax: optNum(raw.dry_temp_max),
      dryTime: optNum(raw.dry_time),
      flowRatio: optNum(raw.flow_ratio),
      kValue: optNum(raw.k_value),
      maxVolumetricSpeed: optNum(raw.max_volumetric_speed),
      softeningTemp: optNum(raw.softening_temp),
    };
  }
}
