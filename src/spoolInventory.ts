// ABOUTME: The spools on a SpoolEase console as an inventory: what's left on each, filtered by words and sorted.
// ABOUTME: Pure functions over the spool records and custom-filament names SpoolEase serves.

import type { CustomFilament, SpoolRecord } from "./spoolease.js";

export const INVENTORY_SORTS = ["newest", "name", "left", "location"] as const;

export type InventorySort = (typeof INVENTORY_SORTS)[number];

export interface InventoryRow {
  spool: SpoolRecord;
  name: string;
  /** Grams of filament left; null until the spool is weighed. */
  left: number | null;
  /** left as a share of the label weight, 0 to 1; null when either is unknown. */
  fraction: number | null;
}

/**
 * Filament left, as SpoolEase works it out (view_model.rs weight_left_spool): the last weight less the
 * core, or less the full weight's excess over the label weight when the core is unknown, less what was
 * printed since that weigh.
 */
export function remainingGrams(spool: SpoolRecord): number | null {
  const { currentWeight, coreWeight, fullWeight, labelWeight } = spool;
  if (currentWeight === null) return null;
  let core: number;
  if (coreWeight !== null) core = coreWeight;
  else if (fullWeight !== null && labelWeight !== null) core = fullWeight - labelWeight;
  else return null;
  return Math.max(0, Math.round(currentWeight - core - spool.consumedSinceWeighed));
}

function spoolName(spool: SpoolRecord, names: ReadonlyMap<string, CustomFilament>): string {
  return (
    names.get(spool.slicerFilament)?.name ||
    [spool.brand, spool.material, spool.colorName].filter(Boolean).join(" ") ||
    spool.slicerFilament
  );
}

const byText = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { sensitivity: "base" });
const newest = (a: InventoryRow, b: InventoryRow): number =>
  Number(b.spool.id) - Number(a.spool.id);
/** Unknowns (null or "") go last whatever the order. */
function lastIfMissing<T>(a: T | null, b: T | null, compare: (x: T, y: T) => number): number {
  if (a === null || a === "") return b === null || b === "" ? 0 : 1;
  if (b === null || b === "") return -1;
  return compare(a, b);
}

const SORTS: Record<InventorySort, (a: InventoryRow, b: InventoryRow) => number> = {
  newest,
  name: (a, b) => byText(a.name, b.name) || newest(a, b),
  left: (a, b) => lastIfMissing(a.left, b.left, (x, y) => x - y) || newest(a, b),
  location: (a, b) => lastIfMissing(a.spool.location, b.spool.location, byText) || newest(a, b),
};

/** The spools matching every word of `filter` (name, location, filament code or #id), in `sort` order. */
export function inventoryRows(
  spools: SpoolRecord[],
  names: ReadonlyMap<string, CustomFilament>,
  filter: string,
  sort: InventorySort,
): InventoryRow[] {
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  return spools
    .map((spool): InventoryRow => {
      const left = remainingGrams(spool);
      const fraction =
        left !== null && spool.labelWeight ? Math.min(1, left / spool.labelWeight) : null;
      return { spool, name: spoolName(spool, names), left, fraction };
    })
    .filter((row) => {
      const text = [row.name, row.spool.location, row.spool.slicerFilament, `#${row.spool.id}`]
        .join(" ")
        .toLowerCase();
      return words.every((word) => text.includes(word));
    })
    .sort(SORTS[sort]);
}
