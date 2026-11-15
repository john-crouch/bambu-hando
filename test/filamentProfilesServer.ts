// ABOUTME: Local stand-in for the 3DFilamentProfiles v1 API: bearer key, monthly quota headers, spools and filaments.
// ABOUTME: Follows the documented shapes, status codes and quota rules (401/402 don't count), and records every request.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export const TEST_API_KEY = "3dfp_fake_key_for_tests";

export interface ServerSpool {
  short_code: string;
  filament_id: number;
  brand: string;
  material: string;
  material_type: string | null;
  color: string;
  rgb: string | null;
  td_value: number | null;
  notes: string | null;
  location: string | null;
  remaining_grams: number;
  empty_spool_weight: number | null;
  updated_at: string;
  spool_properties: Record<string, unknown> | null;
  bambu_spool_id: string | null;
  bambu_tag_id: string | null;
}

export interface ServerFilament {
  id: number;
  brand_key: string;
  brand_name: string;
  material_key: string;
  material: string;
  material_type_key: string | null;
  material_type: string | null;
  color: string;
  rgb: string | null;
  td_value: number | null;
  discontinued: boolean;
  temp_min: number | null;
  temp_max: number | null;
  bed_temp_min: number | null;
  bed_temp_max: number | null;
  density: number | null;
  diameter: number | null;
  nominal_weight: number | null;
  spool_weight: number | null;
}

export interface RecordedApiRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

export interface FilamentProfilesServer {
  url: string;
  requests: RecordedApiRequest[];
  /** The account's quota; counted requests decrement remaining, and 0 means 429 rate_limited. */
  quota: { limit: number; remaining: number };
  /** Set false to drop the X-RateLimit headers from responses. */
  sendQuotaHeaders: boolean;
  /** "no_access" makes every request with the right key answer 402. */
  access: "active" | "no_access";
  spools: ServerSpool[];
  filaments: ServerFilament[];
  locations: string[];
  /** Overrides keyed by "METHOD /path" or "/path"; still counted against the quota. */
  replies: Record<string, { status: number; body: unknown; headers?: Record<string, string> }>;
  close: () => Promise<void>;
}

export function serverSpool(overrides: Partial<ServerSpool> = {}): ServerSpool {
  return {
    short_code: "ABC123",
    filament_id: 101,
    brand: "Sunlu",
    material: "PETG",
    material_type: null,
    color: "Vivid Yellow",
    rgb: "#FFD700",
    td_value: null,
    notes: null,
    location: "Shelf A",
    remaining_grams: 740,
    empty_spool_weight: 189,
    updated_at: "2026-10-14T18:02:11.000Z",
    spool_properties: null,
    bambu_spool_id: null,
    bambu_tag_id: null,
    ...overrides,
  };
}

export function serverFilament(overrides: Partial<ServerFilament> = {}): ServerFilament {
  return {
    id: 101,
    brand_key: "sunlu",
    brand_name: "Sunlu",
    material_key: "petg",
    material: "PETG",
    material_type_key: null,
    material_type: null,
    color: "Vivid Yellow",
    rgb: "#FFD700",
    td_value: null,
    discontinued: false,
    temp_min: 230,
    temp_max: 250,
    bed_temp_min: 70,
    bed_temp_max: 80,
    density: 1270,
    diameter: 1750,
    nominal_weight: 1000,
    spool_weight: 189,
    ...overrides,
  };
}

function error(status: number, code: string, message: string): { status: number; body: unknown } {
  return { status, body: { error: { code, message } } };
}

// The list is the My Spools export shape: no Bambu IDs.
function listed(spool: ServerSpool): Record<string, unknown> {
  const { bambu_spool_id: _spoolId, bambu_tag_id: _tagId, ...rest } = spool;
  return { ...rest, spool_url: `https://spooldb.com/s/${spool.short_code}` };
}

function detailed(spool: ServerSpool): Record<string, unknown> {
  return {
    short_code: spool.short_code,
    filament_id: spool.filament_id,
    brand_name: spool.brand,
    material: spool.material,
    material_type: spool.material_type,
    color: spool.color,
    rgb: spool.rgb,
    remaining_grams: spool.remaining_grams,
    location: spool.location,
    notes: spool.notes,
    updated_at: spool.updated_at,
    url: `https://spooldb.com/s/${spool.short_code}`,
    bambu_spool_id: spool.bambu_spool_id,
    bambu_tag_id: spool.bambu_tag_id,
    stores: [],
  };
}

function summary(filament: ServerFilament): Record<string, unknown> {
  const { temp_min, temp_max, bed_temp_min, bed_temp_max, density, diameter, nominal_weight, spool_weight, ...rest } = filament;
  return { ...rest, url: `https://3dfilamentprofiles.com/filament/details/${filament.id}` };
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let text = "";
  for await (const chunk of req) text += chunk;
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return Symbol.for("invalid-json");
  }
}

export async function startFilamentProfilesServer(): Promise<FilamentProfilesServer> {
  let nextCode = 1;
  const state: FilamentProfilesServer = {
    url: "",
    requests: [],
    quota: { limit: 1000, remaining: 1000 },
    sendQuotaHeaders: true,
    access: "active",
    spools: [],
    filaments: [],
    locations: ["Shelf A", "Shelf B", "AMS 1 Slot 1"],
    replies: {},
    close: async () => {},
  };

  function spoolUpdate(spool: ServerSpool, body: Record<string, unknown>): { status: number; body: unknown } {
    const weights = ["remaining_grams", "used_grams", "used_mm"].filter((field) => body[field] !== undefined);
    if (weights.length > 1) return error(400, "invalid_request", "Send at most one of remaining_grams, used_grams and used_mm");
    let deducted = 0;
    if (body.remaining_grams !== undefined) {
      const grams = body.remaining_grams;
      if (!Number.isInteger(grams) || (grams as number) < 0 || (grams as number) > 10000) return error(400, "invalid_request", "remaining_grams: expected an integer from 0 to 10000");
      spool.remaining_grams = grams as number;
    }
    if (body.used_grams !== undefined) {
      const used = body.used_grams as number;
      if (typeof used !== "number" || used <= 0 || used > 10000) return error(400, "invalid_request", "used_grams: expected a number above 0 and at most 10000");
      deducted = Math.min(used, spool.remaining_grams);
      spool.remaining_grams = Math.max(0, Math.round(spool.remaining_grams - used));
    }
    if (body.location !== undefined) {
      if (body.location === null) spool.location = null;
      else {
        const name = String(body.location).trim().toLowerCase();
        const match = state.locations.find((location) => location.toLowerCase() === name);
        if (!match || name === "empty") return error(422, "invalid_location", "No saved location has that name");
        spool.location = match;
      }
    }
    if (spool.remaining_grams === 0) spool.location = "Empty";
    for (const field of ["bambu_spool_id", "bambu_tag_id"] as const) {
      if (body[field] === undefined) continue;
      const value = body[field] === "" ? null : (body[field] as string | null);
      if (field === "bambu_tag_id" && value !== null) for (const other of state.spools) if (other.bambu_tag_id === value) other.bambu_tag_id = null;
      spool[field] = value;
    }
    spool.updated_at = new Date().toISOString();
    return {
      status: 200,
      body: {
        short_code: spool.short_code,
        remaining_grams: spool.remaining_grams,
        deducted_grams: deducted,
        location: spool.location ?? "Shelf",
        bambu_spool_id: spool.bambu_spool_id,
        bambu_tag_id: spool.bambu_tag_id,
      },
    };
  }

  function route(method: string, path: string, query: Record<string, string>, body: unknown): { status: number; body: unknown } {
    if (body === Symbol.for("invalid-json")) return error(400, "invalid_request", "Body is not valid JSON");
    const fields = (body ?? {}) as Record<string, unknown>;
    if (method === "GET" && path === "/api/v1/my/spools") return { status: 200, body: { data: state.spools.map(listed) } };
    if (method === "POST" && path === "/api/v1/my/spools") {
      const filament = state.filaments.find((f) => f.id === fields.filament_id);
      if (!filament) return error(404, "filament_not_found", "No filament has that filament_id");
      const owned = state.spools.filter((s) => s.filament_id === filament.id && s.remaining_grams > 0);
      if (fields.if_not_owned === true && owned.length > 0) {
        return { status: 200, body: { created: false, spools: owned.map((s) => ({ short_code: s.short_code, url: `https://spooldb.com/s/${s.short_code}` })) } };
      }
      const spool = serverSpool({
        short_code: `NEW${String(nextCode++).padStart(3, "0")}`,
        filament_id: filament.id,
        brand: filament.brand_name,
        material: filament.material,
        material_type: filament.material_type,
        color: filament.color,
        rgb: filament.rgb,
        remaining_grams: (fields.remaining_grams as number | undefined) ?? filament.nominal_weight ?? 1000,
        notes: (fields.notes as string | undefined) ?? null,
        empty_spool_weight: filament.spool_weight,
      });
      state.spools.push(spool);
      return { status: 201, body: { created: true, spool: detailed(spool) } };
    }
    const spoolMatch = /^\/api\/v1\/my\/spools\/([^/]+)$/.exec(path);
    if (spoolMatch) {
      const spool = state.spools.find((s) => s.short_code === decodeURIComponent(spoolMatch[1] ?? ""));
      if (!spool) return error(404, "not_found", "No spool matches the identifier");
      if (method === "GET") return { status: 200, body: detailed(spool) };
      if (method === "PATCH") return spoolUpdate(spool, fields);
    }
    if (method === "GET" && path === "/api/v1/filaments") {
      const limit = Number(query.limit ?? 25);
      const page = Number(query.page ?? 1);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) return error(400, "invalid_request", "limit: Too big: expected number to be <=50");
      if (!Number.isInteger(page) || page < 1 || page > 20) return error(400, "invalid_request", "page: expected 1 to 20");
      const words = (query.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const matching = state.filaments.filter(
        (f) =>
          (!query.brand || f.brand_key === query.brand) &&
          (!query.material || f.material_key === query.material) &&
          (!query.type || f.material_type_key === query.type) &&
          words.every((word) => `${f.brand_name} ${f.material} ${f.material_type ?? ""} ${f.color}`.toLowerCase().includes(word)),
      );
      const data = matching.slice((page - 1) * limit, page * limit).map(summary);
      return { status: 200, body: { data, page, limit, total: matching.length, total_is_estimate: false } };
    }
    const filamentMatch = /^\/api\/v1\/filaments\/(\d+)$/.exec(path);
    if (method === "GET" && filamentMatch) {
      const filament = state.filaments.find((f) => f.id === Number(filamentMatch[1]));
      if (!filament) return error(404, "not_found", "No filament matches the identifier");
      return { status: 200, body: { ...summary(filament), ...filament, chamber_temp: null, stores: [] } };
    }
    return error(404, "not_found", `No route for ${method} ${path}`);
  }

  function bearer(req: IncomingMessage): string | null {
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) return auth.slice("Bearer ".length);
    const header = req.headers["x-api-key"];
    return typeof header === "string" ? header : null;
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = req.method ?? "GET";
    const body = await readBody(req);
    state.requests.push({ method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body });

    const send = (status: number, payload: unknown, headers: Record<string, string> = {}, counted = true): void => {
      const quotaHeaders: Record<string, string> =
        counted && state.sendQuotaHeaders ? { "X-RateLimit-Limit": String(state.quota.limit), "X-RateLimit-Remaining": String(state.quota.remaining) } : {};
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "private, no-store", ...quotaHeaders, ...headers });
      res.end(JSON.stringify(payload));
    };

    // Rejected keys and lapsed access don't count toward the quota.
    if (bearer(req) !== TEST_API_KEY) return send(401, error(401, "invalid_key", "The API key is missing, malformed or has been regenerated").body, {}, false);
    if (state.access === "no_access") return send(402, error(402, "no_access", "The key is valid but the account has no active API access").body, {}, false);
    if (state.quota.remaining <= 0) return send(429, error(429, "rate_limited", "The monthly request quota has been used").body);
    state.quota.remaining -= 1;

    const override = state.replies[`${method} ${url.pathname}`] ?? state.replies[url.pathname];
    const reply = override ?? route(method, url.pathname, Object.fromEntries(url.searchParams), body);
    send(reply.status, reply.body, override?.headers);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      res.writeHead(500);
      res.end(String(err));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  state.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  state.close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return state;
}
