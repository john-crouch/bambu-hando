// ABOUTME: What the Spools tab shows, as pure functions: the console connection, the summary line, a spool's detail.
// ABOUTME: Reads the console's spools and custom filaments and the sync check from the shell's resources.

import type { CustomFilament, SpoolEaseConnection } from "../../../spoolease.js";
import { type InventoryRow, type InventorySort, remainingGrams } from "../../../spoolInventory.js";
import { checkCounts } from "../../../syncCheck.js";
import type { CheckData, ConsoleData, Resource } from "../../core/types.js";
import type { FormValues } from "../../core/values.js";
import { formatRange } from "../../ui/index.js";

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

/** The console's web address (the design system's consoleUrl); never carries the key. */
export { consoleUrl } from "../../ui/index.js";

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
  return formatRange(filament?.nozzleTempMin, filament?.nozzleTempMax);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * When a spool came, one format everywhere: "Oct 30" this year, "2025-11-10" before; "" when unset.
 * Local time.
 */
export function addedText(seconds: number | null, now: number): string {
  if (!seconds) return "";
  const date = new Date(seconds * 1000);
  if (date.getFullYear() === new Date(now).getFullYear())
    return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
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
  /** Spools under LOW_FRACTION of their label weight, empty ones not counted. */
  low: number;
  /** Weighed spools with nothing left. */
  empty: number;
  /** Spools without a weight yet (new ones, until their first weigh). */
  unweighed: number;
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
  let empty = 0;
  let unweighed = 0;
  for (const spool of data.spools) {
    const left = remainingGrams(spool);
    if (left === null) {
      unweighed += 1;
      continue;
    }
    leftGrams += left;
    if (left === 0) empty += 1;
    else if (spool.labelWeight && left / spool.labelWeight < LOW_FRACTION) low += 1;
  }
  return {
    count: data.spools.length,
    leftGrams,
    low,
    empty,
    unweighed,
    sync: syncState(check),
  };
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
  if (left === 0)
    return {
      label: "Left",
      value: spool.labelWeight ? `empty (0 g of ${spool.labelWeight} g)` : "empty",
      tone: "failed",
    };
  if (!spool.labelWeight || fraction === null) return { label: "Left", value: `${left} g` };
  const value = `${left} g of ${spool.labelWeight} g · ${Math.round(fraction * 100)}%`;
  const tone = barTone(fraction);
  return tone ? { label: "Left", value, tone } : { label: "Left", value };
}

/** The highlighted spool in full: what's left, its spool, where it is, its tag, when it came, its temperatures. */
export function spoolDetail(
  row: InventoryRow,
  filaments: ReadonlyMap<string, CustomFilament>,
  now: number,
): SpoolDetail {
  const { spool } = row;
  const nozzle = nozzleRange(filaments.get(spool.slicerFilament));
  const added = addedText(spool.addedTime, now);
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
  ];
  return {
    title: row.name,
    subtitle: filamentLine(row),
    swatch: swatchOf(spool.colorCodes),
    rows,
  };
}

/** Brand · material · filament code. */
function filamentLine({ spool }: InventoryRow): string {
  const material = [spool.material, spool.subtype].filter(Boolean).join(" ");
  return [spool.brand, material, spool.slicerFilament || "no filament code"]
    .filter(Boolean)
    .join(" · ");
}

/** The highlighted spool in three lines, for a panel under the list when there's no room beside it. */
export function compactDetail(
  row: InventoryRow,
  filaments: ReadonlyMap<string, CustomFilament>,
  now: number,
): DetailRow[] {
  const { spool } = row;
  const join = (...parts: string[]) => parts.filter(Boolean).join(" · ");
  const core = spool.coreWeight ? `${spool.coreWeight} g spool` : "empty spool unknown";
  const left = leftRow(row);
  const added = addedText(spool.addedTime, now);
  const place: DetailRow = {
    label: "Place",
    value: join(
      spool.location || "not placed",
      spool.tagId ? `tag ${spool.tagId}` : "no tag",
      added ? `added ${added}` : "",
    ),
  };
  return [
    { ...left, value: join(left.value, core) },
    spool.location || spool.tagId ? place : { ...place, dim: true },
    {
      label: "Filament",
      value: join(filamentLine(row), nozzleRange(filaments.get(spool.slicerFilament))),
    },
  ];
}
