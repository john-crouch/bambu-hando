// ABOUTME: Sync orchestration shared by the headless CLI and the TUI.
// ABOUTME: Writes presets, then pushes to SpoolEase, emitting per-profile progress events.

import { SystemProfiles } from "./bambuProfiles.js";
import { type PresetOutcome, writeMany } from "./bambuStudio.js";
import { errorMessage } from "./errors.js";
import type { FilamentProfile, Status, SyncResult } from "./models.js";
import { bambuConfigDir } from "./paths.js";
import { buildCustomFilamentsCsv, mergeCustomFilamentsCsv, SpoolEaseClient, type SpoolEaseConnection } from "./spoolease.js";

const DETAIL_LIMIT = 120;

export interface SyncOptions {
  profiles: FilamentProfile[];
  presetFolder: string;
  /** BambuStudio printer preset names, e.g. "Bambu Lab X1 Carbon 0.4 nozzle"; one preset is written per printer. */
  printers: string[];
  dryRun: boolean;
  /** null skips SpoolEase entirely. */
  spoolease: SpoolEaseConnection | null;
  /** Also create one SpoolEase spool per filament that doesn't have one yet. */
  createSpools: boolean;
  /** Replace BambuStudio presets that already exist instead of keeping them. */
  overwritePresets?: boolean;
}

export type SyncStage = "presets" | "key-check" | "custom-filaments" | "spools";

export type SyncEvent =
  | { type: "stage"; stage: SyncStage }
  | { type: "preset"; index: number; status: Status; paths: string[]; kept: string[]; error: string }
  | { type: "spool"; index: number; status: Status; detail: string }
  | { type: "warning"; message: string };

export interface SyncOutcome {
  presets: PresetOutcome[];
  results: SyncResult[];
}

/** SpoolEase rejected the key or could not be reached; nothing was sent to it. */
export class KeyCheckError extends Error {
  override name = "KeyCheckError";
}

/** BambuStudio isn't set up for this run (no system profiles, unknown printer); nothing was written or sent. */
export class SetupError extends Error {
  override name = "SetupError";
}

/** Throws KeyCheckError when SpoolEase can't be reached or rejects the key. */
export async function checkKey(client: SpoolEaseClient): Promise<void> {
  let keyOk: boolean;
  try {
    keyOk = await client.testKey();
  } catch (err) {
    throw new KeyCheckError(`SpoolEase unreachable at ${client.baseUrl}: ${errorMessage(err)}`);
  }
  if (!keyOk) throw new KeyCheckError("SpoolEase key validation failed");
}

async function loadSystemProfiles(printers: string[]): Promise<SystemProfiles> {
  let system: SystemProfiles;
  try {
    system = await SystemProfiles.load(bambuConfigDir());
  } catch (err) {
    throw new SetupError(errorMessage(err));
  }
  const known = system.printers();
  if (printers.length === 0) throw new SetupError("no BambuStudio printer given");
  for (const printer of printers) {
    if (!known.includes(printer)) throw new SetupError(`unknown BambuStudio printer "${printer}"; known printers: ${known.join(", ")}`);
  }
  return system;
}

// A profile whose presets all exist already was skipped; one with any new preset was written.
function presetStatus(outcome: PresetOutcome | undefined, dryRun: boolean): Status {
  if (outcome?.error) return "failed";
  if (outcome && outcome.paths.length > 0 && outcome.kept.length === outcome.paths.length) return "skipped";
  return dryRun ? "planned" : "written";
}

export async function runSync(options: SyncOptions, onEvent: (event: SyncEvent) => void = () => {}): Promise<SyncOutcome> {
  const { profiles, dryRun } = options;
  const system = await loadSystemProfiles(options.printers);

  onEvent({ type: "stage", stage: "presets" });
  const target = { presetFolder: options.presetFolder, printers: options.printers, system };
  const presets = await writeMany(profiles, target, { dryRun, overwrite: options.overwritePresets ?? false }, (index, outcome) =>
    onEvent({ type: "preset", index, status: presetStatus(outcome, dryRun), ...outcome }),
  );

  const spools = await syncSpoolEase(options, onEvent);

  const results = profiles.map((profile, index): SyncResult => {
    const bambuError = presets[index]?.error ?? "";
    const bambuStatus = presetStatus(presets[index], dryRun);
    const spool = spools[index] ?? { status: "skipped" as Status, detail: "" };
    let detail = spool.detail;
    if (bambuError) detail = `BambuStudio preset: ${bambuError}; ${spool.detail}`;
    else if (bambuStatus === "skipped") detail = `BambuStudio preset exists (overwrite to replace it); ${spool.detail}`;
    return {
      profileName: profile.name,
      filamentId: profile.filamentId,
      bambuStatus,
      spooleaseStatus: spool.status,
      detail,
    };
  });

  return { presets, results };
}

async function syncSpoolEase(options: SyncOptions, onEvent: (event: SyncEvent) => void): Promise<{ status: Status; detail: string }[]> {
  const { profiles, dryRun, spoolease } = options;

  if (!spoolease) {
    return profiles.map((_, index) => {
      onEvent({ type: "spool", index, status: "skipped", detail: "SpoolEase skipped" });
      return { status: "skipped", detail: "SpoolEase skipped" };
    });
  }

  const client = new SpoolEaseClient(spoolease);
  let csvError = "";

  if (!dryRun) {
    onEvent({ type: "stage", stage: "key-check" });
    await checkKey(client);

    onEvent({ type: "stage", stage: "custom-filaments" });
    let existing: string | null = null;
    try {
      existing = await client.getCustomFilamentsCsv();
    } catch (err) {
      // Writing without the current list would replace it with only ours, so don't write at all.
      onEvent({ type: "warning", message: `Failed to read current custom filaments CSV: ${errorMessage(err)}` });
      csvError = `custom filaments CSV: reading current list failed: ${errorMessage(err)}`;
    }

    if (existing !== null) {
      try {
        const merged = mergeCustomFilamentsCsv(existing, buildCustomFilamentsCsv(profiles));
        const stored = await client.setCustomFilamentsCsv(merged);
        if (!stored.ok) {
          onEvent({ type: "warning", message: `Failed to set custom filaments CSV: ${stored.error}` });
          csvError = `custom filaments CSV: ${stored.error.slice(0, DETAIL_LIMIT)}`;
        }
      } catch (err) {
        onEvent({ type: "warning", message: `Failed to set custom filaments CSV: ${errorMessage(err)}` });
        csvError = `custom filaments CSV: ${errorMessage(err)}`;
      }
    }
  }

  // SpoolEase creates a new record for every add with an empty id, so look up which filaments
  // already have a spool once, and keep the set current as we add.
  let spooledIds = new Set<string>();
  let listError = "";
  if (!dryRun && !csvError && options.createSpools) {
    onEvent({ type: "stage", stage: "spools" });
    try {
      spooledIds = await client.listSpoolFilamentIds();
    } catch (err) {
      listError = `listing spools failed: ${errorMessage(err)}`;
    }
  }

  const outcomes: { status: Status; detail: string }[] = [];
  for (const [index, profile] of profiles.entries()) {
    const registered = `registered ${profile.filamentId}`;
    let outcome: { status: Status; detail: string };
    if (dryRun) {
      outcome = { status: "planned", detail: "dry-run" };
    } else if (csvError) {
      // Spools reference filament codes from the CSV, so creating them after a CSV failure would leave SpoolEase half-configured.
      outcome = { status: "failed", detail: csvError };
    } else if (!options.createSpools) {
      outcome = { status: "written", detail: registered };
    } else if (listError) {
      outcome = { status: "failed", detail: `${registered}; ${listError}` };
    } else if (spooledIds.has(profile.filamentId)) {
      outcome = { status: "written", detail: `${registered}; spool already exists` };
    } else {
      try {
        const created = await client.addSpool(profile);
        if (created.ok) {
          spooledIds.add(profile.filamentId);
          outcome = { status: "written", detail: `${registered}; spool ${created.id} created` };
        } else {
          outcome = { status: "failed", detail: `${registered}; spool rejected: ${created.error.slice(0, DETAIL_LIMIT)}` };
        }
      } catch (err) {
        outcome = { status: "failed", detail: `${registered}; spool request error: ${errorMessage(err)}` };
      }
    }
    outcomes.push(outcome);
    onEvent({ type: "spool", index, ...outcome });
  }
  return outcomes;
}
