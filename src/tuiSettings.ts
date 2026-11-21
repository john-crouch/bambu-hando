// ABOUTME: Remembers the TUI's last choices (the printers presets are written for, empty spool weights per brand).
// ABOUTME: Stored as JSON in bambu-hando's config directory; damaged or unknown values are ignored.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { writeAtomic } from "./atomicWrite.js";
import { configDir } from "./paths.js";
import type { WeightChoice } from "./spoolWeights.js";

export interface TuiSettings {
  /** BambuStudio printers of the last run; empty when none was saved. */
  printers: string[];
  /** The empty spool weight last chosen per brand, by brand key (spoolWeights.ts brandKey); left out when none is. */
  weights?: Record<string, WeightChoice>;
}

export function tuiSettingsPath(): string {
  return join(configDir(), "tui.json");
}

/** A saved weight choice, when it's one: grams are whole and not negative, as SpoolEase takes them. */
function weightChoice(value: unknown): WeightChoice | null {
  if (typeof value !== "object" || value === null) return null;
  const { kind, grams } = value as { kind?: unknown; grams?: unknown };
  if (kind === "source" || kind === "unspecified") return { kind };
  if (kind === "grams" && typeof grams === "number" && Number.isInteger(grams) && grams >= 0)
    return { kind, grams };
  return null;
}

function weightsOf(value: unknown): Record<string, WeightChoice> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const weights: Record<string, WeightChoice> = {};
  for (const [key, saved] of Object.entries(value)) {
    const choice = weightChoice(saved);
    if (key && choice) weights[key] = choice;
  }
  return weights;
}

export async function loadTuiSettings(path = tuiSettingsPath()): Promise<TuiSettings> {
  let saved: Record<string, unknown>;
  try {
    saved = JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return { printers: [] };
  }
  const printers = Array.isArray(saved.printers)
    ? saved.printers.filter((p): p is string => typeof p === "string" && p.trim() !== "")
    : [];
  const weights = weightsOf(saved.weights);
  return Object.keys(weights).length > 0 ? { printers, weights } : { printers };
}

/** Saves run one after another, each reading what the last one wrote, so none drops another's change. */
let saving: Promise<unknown> = Promise.resolve();

function serially<T>(work: () => Promise<T>): Promise<T> {
  const run = saving.then(work, work);
  saving = run.catch(() => undefined);
  return run;
}

async function write(settings: TuiSettings, path: string): Promise<void> {
  await writeAtomic(path, `${JSON.stringify(settings, null, 2)}\n`);
}

/**
 * Saves the given settings over the remembered ones, keeping those not given (a printer save keeps the
 * weights). Written atomically (a temp file of its own per save), so an interrupted save never leaves
 * a broken file.
 */
export function saveTuiSettings(
  settings: Partial<TuiSettings>,
  path = tuiSettingsPath(),
): Promise<void> {
  return serially(async () => write({ ...(await loadTuiSettings(path)), ...settings }, path));
}

/** Remembers the empty spool weight chosen for a brand, beside the other brands'. */
export function rememberWeight(
  key: string,
  choice: WeightChoice,
  path = tuiSettingsPath(),
): Promise<void> {
  return serially(async () => {
    const current = await loadTuiSettings(path);
    await write({ ...current, weights: { ...current.weights, [key]: choice } }, path);
  });
}
