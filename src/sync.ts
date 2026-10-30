// ABOUTME: Sync orchestration shared by the headless CLI and the TUI.
// ABOUTME: Writes presets, then pushes to SpoolEase, emitting per-profile progress events.

import { type PresetOutcome, writeMany } from "./bambuStudio.js";
import { errorMessage } from "./errors.js";
import type { FilamentProfile, Status, SyncResult } from "./models.js";
import { buildCustomFilamentsCsv, mergeCustomFilamentsCsv, SpoolEaseClient, type SpoolEaseConnection } from "./spoolease.js";

const DETAIL_LIMIT = 120;

export interface SyncOptions {
  profiles: FilamentProfile[];
  presetFolder: string;
  printerPreset: string;
  dryRun: boolean;
  /** null skips SpoolEase entirely. */
  spoolease: SpoolEaseConnection | null;
  /**
   * Also create one SpoolEase spool per filament that doesn't have one yet. Off by default:
   * a spool stands for a physical (usually tagged) spool, not a catalog entry.
   */
  createSpools: boolean;
}

export type SyncStage = "presets" | "key-check" | "custom-filaments" | "spools";

export type SyncEvent =
  | { type: "stage"; stage: SyncStage }
  | { type: "preset"; index: number; status: Status; path: string; error: string }
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

export async function runSync(options: SyncOptions, onEvent: (event: SyncEvent) => void = () => {}): Promise<SyncOutcome> {
  const { profiles, dryRun } = options;
  const presetStatus: Status = dryRun ? "planned" : "written";

  onEvent({ type: "stage", stage: "presets" });
  const presets = await writeMany(profiles, options.presetFolder, options.printerPreset, dryRun, (index, outcome) =>
    onEvent({ type: "preset", index, status: outcome.error ? "failed" : presetStatus, ...outcome }),
  );

  const spools = await syncSpoolEase(options, onEvent);

  const results = profiles.map((profile, index): SyncResult => {
    const bambuError = presets[index]?.error ?? "";
    const spool = spools[index] ?? { status: "skipped" as Status, detail: "" };
    return {
      profileName: profile.name,
      filamentId: profile.filamentId,
      bambuStatus: bambuError ? "failed" : presetStatus,
      spooleaseStatus: spool.status,
      detail: bambuError ? `BambuStudio preset: ${bambuError}; ${spool.detail}` : spool.detail,
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
    let keyOk: boolean;
    try {
      keyOk = await client.testKey();
    } catch (err) {
      throw new KeyCheckError(`SpoolEase unreachable at ${client.baseUrl}: ${errorMessage(err)}`);
    }
    if (!keyOk) throw new KeyCheckError("SpoolEase key validation failed");

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
        const { status, body } = await client.setCustomFilamentsCsv(merged);
        if (status >= 400) {
          onEvent({ type: "warning", message: `Failed to set custom filaments CSV: ${status} ${body}` });
          csvError = `custom filaments CSV: HTTP ${status}: ${body.slice(0, DETAIL_LIMIT)}`;
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
        const { status, body } = await client.addOrEditSpool(profile);
        const reply = `HTTP ${status}: ${body.slice(0, DETAIL_LIMIT)}`;
        if (status < 400) {
          spooledIds.add(profile.filamentId);
          outcome = { status: "written", detail: `${registered}; spool created: ${reply}` };
        } else {
          outcome = { status: "failed", detail: `${registered}; spool rejected: ${reply}` };
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
