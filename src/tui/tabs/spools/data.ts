// ABOUTME: What the Spools tab shows, as pure functions: the console connection, the summary line, a spool's detail.
// ABOUTME: Reads the console's spools and custom filaments and the sync check from the shell's resources.

import type { CustomFilament, SpoolEaseConnection } from "../../../spoolease.js";
import { type InventoryRow, type InventorySort, remainingGrams } from "../../../spoolInventory.js";
import { checkCounts } from "../../../syncCheck.js";
import type { CheckData, ConsoleData, Resource } from "../../core/types.js";
import type { FormValues } from "../../core/values.js";

/** Under this share of the label weight a spool counts as low (yellow); under LOW_RED it's red. */
export const LOW_FRACTION = 0.25;
const LOW_RED = 0.1;

export const SORT_LABELS: Record<InventorySort, string> = {
  newest: "newest first",
  name: "by name",
  left: "least left first",
  location: "by location",
};

export type Tone = "ok" | "warning" | "failed";

/** The console the settings point at; null when SpoolEase is skipped or its host or key is missing. */
export function consoleConnection(values: FormValues): SpoolEaseConnection | null {
  const host = values.host.trim();
  if (values.skipSpoolease || !host || !values.securityKey) return null;
  return { host, port: Number(values.port), securityKey: values.securityKey, https: values.https };
}

/** The console's address, as SpoolEaseClient.baseUrl has it; never carries the key. */
export function consoleUrl(conn: SpoolEaseConnection): string {
  return `${conn.https ? "https" : "http"}://${conn.host}:${conn.port}`;
}

/** The console data to show: the loaded value, else the last good one kept while reloading or after a failure. */
export function consoleValue(resource: Resource<ConsoleData>): ConsoleData | undefined {
  if (resource.state === "ready") return resource.value;
  if (resource.state === "loading" || resource.state === "failed") return resource.previous;
  return undefined;
}

export function barTone(fraction: number | null): Tone | undefined {
  if (fraction === null) return undefined;
  return fraction < LOW_RED ? "failed" : fraction < LOW_FRACTION ? "warning" : "ok";
}

/** A spool's (first) color as "#RRGGBB" for a swatch. */
export function swatchOf(colorCodes: string[]): string | undefined {
  const code = colorCodes[0];
  return code && /^[0-9A-F]{6}/i.test(code) ? `#${code.slice(0, 6).toUpperCase()}` : undefined;
}

export function nozzleRange(filament: CustomFilament | undefined): string {
  const low = filament?.nozzleTempMin ?? null;
  const high = filament?.nozzleTempMax ?? null;
  if (low === null && high === null) return "";
  if (low === null || high === null || low === high) return `${low ?? high}°C`;
  return `${low}–${high}°C`;
}

/** A Unix-seconds time as the local date, 2026-10-30; "" when unset. */
export function addedDate(seconds: number | null): string {
  if (!seconds) return "";
  const date = new Date(seconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export type SyncState =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "failed"; error: string }
  | { state: "ok" }
  | { state: "problems"; problems: number };

export interface SpoolsSummary {
  count: number;
  /** Filament left on the weighed spools. */
  leftGrams: number;
  /** Spools under LOW_FRACTION of their label weight. */
  low: number;
  sync: SyncState;
}

function syncState(check: Resource<CheckData>): SyncState {
  switch (check.state) {
    case "idle":
      return { state: "idle" };
    case "loading":
      return { state: "checking" };
    case "failed":
      return { state: "failed", error: check.error };
    case "ready": {
      const { problems } = checkCounts(check.value.sections);
      return problems === 0 ? { state: "ok" } : { state: "problems", problems };
    }
  }
}

export function spoolsSummary(data: ConsoleData, check: Resource<CheckData>): SpoolsSummary {
  let leftGrams = 0;
  let low = 0;
  for (const spool of data.spools) {
    const left = remainingGrams(spool);
    if (left === null) continue;
    leftGrams += left;
    if (spool.labelWeight && left / spool.labelWeight < LOW_FRACTION) low += 1;
  }
  return { count: data.spools.length, leftGrams, low, sync: syncState(check) };
}

export interface DetailRow {
  label: string;
  value: string;
  tone?: Tone;
  dim?: boolean;
}

export interface SpoolDetail {
  title: string;
  /** Brand · material · filament code. */
  subtitle: string;
  swatch: string | undefined;
  rows: DetailRow[];
}

function leftRow(row: InventoryRow): DetailRow {
  const { left, fraction, spool } = row;
  if (left === null) return { label: "Left", value: "not weighed yet", dim: true };
  if (!spool.labelWeight || fraction === null) return { label: "Left", value: `${left} g` };
  const value = `${left} g of ${spool.labelWeight} g · ${Math.round(fraction * 100)}%`;
  const tone = barTone(fraction);
  return tone ? { label: "Left", value, tone } : { label: "Left", value };
}

/** The highlighted spool in full: what's left, its spool, where it is, its tag, when it came, its temperatures. */
export function spoolDetail(
  row: InventoryRow,
  filaments: ReadonlyMap<string, CustomFilament>,
): SpoolDetail {
  const { spool } = row;
  const material = [spool.material, spool.subtype].filter(Boolean).join(" ");
  const nozzle = nozzleRange(filaments.get(spool.slicerFilament));
  const added = addedDate(spool.addedTime);
  const rows: DetailRow[] = [
    leftRow(row),
    spool.coreWeight
      ? { label: "Empty", value: `${spool.coreWeight} g spool` }
      : {
          label: "Empty",
          value: "unknown, SpoolEase learns it on the first full weigh",
          dim: true,
        },
    spool.location
      ? { label: "Location", value: spool.location }
      : { label: "Location", value: "not placed", dim: true },
    ...(nozzle ? [{ label: "Nozzle", value: nozzle }] : []),
    spool.tagId
      ? { label: "Tag", value: spool.tagId, dim: true }
      : { label: "Tag", value: "none", dim: true },
    ...(added ? [{ label: "Added", value: added }] : []),
    ...(spool.note ? [{ label: "Note", value: spool.note }] : []),
    { label: "Spool", value: `#${spool.id}`, dim: true },
  ];
  return {
    title: row.name,
    subtitle: [spool.brand, material, spool.slicerFilament || "no filament code"]
      .filter(Boolean)
      .join(" · "),
    swatch: swatchOf(spool.colorCodes),
    rows,
  };
}
