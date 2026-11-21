// ABOUTME: Remembers the TUI's last choices (printers presets are written for, empty spool weights per brand, the console).
// ABOUTME: Stored as JSON in bambu-hando's config directory; damaged or unknown values are ignored; never a key.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { writeAtomic } from "./atomicWrite.js";
import { configDir } from "./paths.js";
import { trackWrite } from "./pendingWrites.js";
import type { WeightChoice } from "./spoolWeights.js";

export interface TuiSettings {
  /** BambuStudio printers of the last run; empty when none was saved. */
  printers: string[];
  /** The empty spool weight last chosen per brand, by brand key (spoolWeights.ts brandKey); left out when none is. */
  weights?: Record<string, WeightChoice>;
  /** The SpoolEase console last set in Settings; its security key is kept in the keyring, never here. */
  console?: SavedConsole;
}

/** Where the SpoolEase console is; each part left out when none was saved. */
export interface SavedConsole {
  host?: string;
  port?: number;
  https?: boolean;
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

/** The good parts of a saved console, by name, so nothing else (a key handed in by mistake) is ever kept. */
function consoleOf(value: unknown): SavedConsole {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const { host, port, https } = value as Record<string, unknown>;
  return {
    ...(typeof host === "string" && host.trim() ? { host: host.trim() } : {}),
    ...(typeof port === "number" && Number.isInteger(port) && port >= 1 && port <= 65_535
      ? { port }
      : {}),
    ...(typeof https === "boolean" ? { https } : {}),
  };
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
  const console = consoleOf(saved.console);
  return {
    printers,
    ...(Object.keys(weights).length > 0 ? { weights } : {}),
    ...(Object.keys(console).length > 0 ? { console } : {}),
  };
}

/** Saves run one after another, each reading what the last one wrote, so none drops another's change. */
let saving: Promise<unknown> = Promise.resolve();

/**
 * Runs a save after the ones before it. The whole save is tracked (`pendingWrites.ts`), its wait and its read of
 * tui.json included, so a quit before its write starts still lets it finish.
 */
function serially<T>(work: () => Promise<T>): Promise<T> {
  const run = trackWrite(saving.then(work, work));
  saving = run.catch(() => undefined);
  return run;
}

async function write(settings: TuiSettings, path: string): Promise<void> {
  const { console, ...rest } = settings;
  const kept = consoleOf(console);
  const file = Object.keys(kept).length > 0 ? { ...rest, console: kept } : rest;
  await writeAtomic(path, `${JSON.stringify(file, null, 2)}\n`);
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

/**
 * Remembers the console (host, port, HTTPS) as one, replacing the saved one, so a port or HTTPS saved for one host
 * never stays behind for another; the parts left out (an empty host too) are forgotten.
 */
export function rememberConsole(console: SavedConsole, path = tuiSettingsPath()): Promise<void> {
  return serially(async () => {
    const { console: _old, ...current } = await loadTuiSettings(path);
    await write({ ...current, console }, path);
  });
}
