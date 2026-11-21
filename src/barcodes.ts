// ABOUTME: Remembers which filament a spool's barcode (UPC, EAN, a maker's SKU) is, once you've said so.
// ABOUTME: Stored as JSON in bambu-hando's config directory; damaged entries are ignored.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { writeAtomic } from "./atomicWrite.js";
import { configDir } from "./paths.js";
import { trackWrite } from "./pendingWrites.js";

export interface BarcodeFilament {
  /** The slicer filament code its spools carry. */
  code: string;
  /** What the filament was called when the barcode was learned, for when no spool of it is left. */
  name: string;
}

export function barcodesPath(): string {
  return join(configDir(), "barcodes.json");
}

/** Without case or spaces, so a code typed by hand matches the same code scanned. */
export function normalizeBarcode(barcode: string): string {
  return barcode.replace(/\s+/g, "").toUpperCase();
}

export async function loadBarcodes(path = barcodesPath()): Promise<Map<string, BarcodeFilament>> {
  let saved: unknown;
  try {
    saved = JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return new Map();
  }
  const barcodes = new Map<string, BarcodeFilament>();
  if (typeof saved !== "object" || saved === null) return barcodes;
  for (const [barcode, value] of Object.entries(saved)) {
    const entry = value as Partial<BarcodeFilament> | null;
    if (typeof entry?.code === "string" && entry.code && typeof entry.name === "string")
      barcodes.set(barcode, { code: entry.code, name: entry.name });
  }
  return barcodes;
}

/** Saves run one after another, each reading what the last one wrote, so none drops another's barcode. */
let saving: Promise<unknown> = Promise.resolve();

/**
 * Saves the answer for `barcode`, replacing an earlier one; written atomically. The whole save is tracked
 * (`pendingWrites.ts`), its read of barcodes.json included, so a quit before its write starts still lets it finish.
 */
export function rememberBarcode(
  barcode: string,
  filament: BarcodeFilament,
  path = barcodesPath(),
): Promise<void> {
  const save = async () => {
    const barcodes = await loadBarcodes(path);
    barcodes.set(normalizeBarcode(barcode), filament);
    await writeAtomic(path, `${JSON.stringify(Object.fromEntries(barcodes), null, 2)}\n`);
  };
  const run = trackWrite(saving.then(save, save));
  saving = run.catch(() => undefined);
  return run;
}
