// ABOUTME: SpoolEase encrypted API client for spool and custom filament updates.
// ABOUTME: Uses documented endpoint behavior from SpoolEase docs and source references.

import { DEFAULT_ITERATIONS, DEFAULT_SALT, decryptText, deriveKey, encryptText } from "./encryption.js";
import type { FilamentProfile } from "./models.js";

const REQUEST_TIMEOUT_MS = 20_000;

// GET /api/spools returns headerless CSV in SpoolRecord field order (spool_record.rs); slicer_filament is 13th.
const SPOOL_SLICER_FILAMENT_COLUMN = 12;

/** Minimal RFC 4180 parser: quoted fields may contain commas, doubled quotes, and newlines. */
function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      record.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field || record.length) {
    record.push(field);
    records.push(record);
  }
  return records;
}

export interface SpoolEaseConnection {
  host: string;
  securityKey: string;
  port: number;
  https: boolean;
  salt?: string;
  iterations?: number;
}

export interface SpoolEaseResponse {
  status: number;
  /** Decrypted body on success; raw body on errors or undecryptable replies. */
  body: string;
}

/** A write SpoolEase stored (with the new record's id, when it has one), or why it didn't. */
export type SpoolEaseWrite = { ok: true; id: string } | { ok: false; error: string };

export class SpoolEaseClient {
  readonly baseUrl: string;
  private readonly key: Buffer;

  constructor(conn: SpoolEaseConnection) {
    this.baseUrl = `${conn.https ? "https" : "http"}://${conn.host}:${conn.port}`;
    this.key = deriveKey(conn.securityKey, conn.salt ?? DEFAULT_SALT, conn.iterations ?? DEFAULT_ITERATIONS);
  }

  private postEncrypted(path: string, payload: unknown): Promise<SpoolEaseResponse & { decrypted: boolean }> {
    return this.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/text" },
      body: encryptText(this.key, JSON.stringify(payload)),
    });
  }

  private async request(path: string, init: RequestInit = {}): Promise<SpoolEaseResponse & { decrypted: boolean }> {
    const resp = await fetch(`${this.baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const body = await resp.text();
    if (resp.status >= 400) return { status: resp.status, body, decrypted: false };
    try {
      return { status: resp.status, body: decryptText(this.key, body), decrypted: true };
    } catch {
      return { status: resp.status, body, decrypted: false };
    }
  }

  /** Decrypted body of a GET; throws on HTTP errors and on replies that can't be decrypted. */
  private async getDecrypted(path: string): Promise<string> {
    const { status, body, decrypted } = await this.request(path);
    if (status >= 400) throw new Error(`HTTP ${status}: ${body}`);
    if (!decrypted) throw new Error("response could not be decrypted");
    return body;
  }

  /**
   * POST a change and read SpoolEase's verdict. HTTP errors only cover requests it couldn't parse:
   * a handler that fails answers 200 with plain text (web_app.rs handle_web_app_post), and a
   * config it refuses answers 200 with an encrypted error_text.
   */
  private async write(path: string, payload: unknown): Promise<SpoolEaseWrite> {
    const { status, body, decrypted } = await this.postEncrypted(path, payload);
    if (status >= 400) return { ok: false, error: `HTTP ${status}: ${body}` };
    if (!decrypted) return { ok: false, error: body || `empty HTTP ${status} reply` };
    let reply: { id?: unknown; error_text?: unknown };
    try {
      reply = JSON.parse(body);
    } catch {
      return { ok: false, error: `unexpected reply: ${body}` };
    }
    if (typeof reply.error_text === "string" && reply.error_text) return { ok: false, error: reply.error_text };
    return { ok: true, id: typeof reply.id === "string" ? reply.id : "" };
  }

  async testKey(): Promise<boolean> {
    const { status } = await this.postEncrypted("/api/test-key", { test: "Hello" });
    return status === 200;
  }

  /** Create a SpoolEase spool record (an empty id asks SpoolEase for a new one). */
  addSpool(profile: FilamentProfile): Promise<SpoolEaseWrite> {
    return this.write("/api/spools/add-edit", spoolPayload(profile));
  }

  setCustomFilamentsCsv(csvText: string): Promise<SpoolEaseWrite> {
    return this.write("/api/filaments-config", { custom_filaments: csvText });
  }

  /** The stored custom-filaments CSV ("" when unset); throws when it can't be read. */
  async getCustomFilamentsCsv(): Promise<string> {
    const parsed: { custom_filaments?: unknown } = JSON.parse(await this.getDecrypted("/api/filaments-config"));
    return typeof parsed.custom_filaments === "string" ? parsed.custom_filaments : "";
  }

  /** slicer_filament values of every stored spool; throws when spools can't be listed. */
  async listSpoolFilamentIds(): Promise<Set<string>> {
    const records = parseCsvRecords(await this.getDecrypted("/api/spools"));
    return new Set(records.map((fields) => fields[SPOOL_SLICER_FILAMENT_COLUMN] ?? "").filter(Boolean));
  }
}

export function spoolPayload(profile: FilamentProfile): Record<string, unknown> {
  return {
    tag_id: "",
    id: "",
    rgba: profile.colorRgba,
    color_name: profile.colorName,
    material: profile.material,
    subtype: "",
    brand: profile.brand,
    core_weight: profile.coreWeight,
    label_weight: profile.labelWeight,
    note: `Generated by bambu-hando for ${profile.name}`,
    slicer_filament: profile.filamentId,
    full_unused: "y",
    k_info: null,
    // Required since SpoolEase 0.7: a new spool has no location yet and stands for one physical spool.
    assigned_location: "",
    actual_location: "",
    spools_count: 1,
  };
}

// SpoolEase parses this CSV with a plain split(',') that ignores quoting (view_model.rs), so commas
// can't be escaped and would shift the temperature columns.
function csvSafe(value: string): string {
  return value.replace(/\s*[,\r\n]+\s*/g, " ").trim();
}

// SpoolEase shows only this name, so it carries the brand; names from SpoolmanDB already start with it.
function displayName(profile: FilamentProfile): string {
  return profile.name.toLowerCase().startsWith(profile.brand.toLowerCase()) ? profile.name : `${profile.brand} ${profile.name}`;
}

/** Generate SpoolEase custom-filaments CSV lines: code,name,nozzle_temp_low,nozzle_temp_high,material */
export function buildCustomFilamentsCsv(profiles: FilamentProfile[]): string {
  return profiles
    .map((p) => `${p.filamentId},${csvSafe(displayName(p))},${p.nozzleTempMin},${p.nozzleTempMax},${csvSafe(p.material)}`)
    .join("\r\n");
}

function csvCode(line: string): string {
  return line.split(",", 1)[0] ?? "";
}

/**
 * SpoolEase stores one CSV and replaces it wholesale on every write, so merge ours into what's there:
 * rows with a matching code are replaced in place, other rows are kept, new rows are appended.
 */
export function mergeCustomFilamentsCsv(existing: string, ours: string): string {
  const ourLines = ours.split(/\r?\n/).filter((line) => line.trim());
  const byCode = new Map(ourLines.map((line) => [csvCode(line), line]));

  const merged = existing
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const replacement = byCode.get(csvCode(line));
      if (replacement === undefined) return line;
      byCode.delete(csvCode(line));
      return replacement;
    });
  return [...merged, ...byCode.values()].join("\r\n");
}
