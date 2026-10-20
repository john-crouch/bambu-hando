// ABOUTME: Sync orchestration shared by the headless CLI and the TUI.
// ABOUTME: Writes presets, then pushes to SpoolEase, emitting per-profile progress events.

import { type PresetOutcome, writeMany } from "./bambuStudio.js";
import type { FilamentProfile, Status, SyncResult } from "./models.js";
import { buildCustomFilamentsCsv, SpoolEaseClient, type SpoolEaseConnection } from "./spoolease.js";

const DETAIL_LIMIT = 120;

export interface SyncOptions {
  profiles: FilamentProfile[];
  presetFolder: string;
  printerPreset: string;
  dryRun: boolean;
  /** null skips SpoolEase entirely. */
  spoolease: SpoolEaseConnection | null;
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

function message(err: unknown): string {
  if (err instanceof Error) {
    // fetch hides the useful part (ECONNREFUSED, timeout) in the cause.
    const cause = err.cause instanceof Error ? `: ${err.cause.message}` : "";
    return `${err.message}${cause}`;
  }
  return String(err);
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
      throw new KeyCheckError(`SpoolEase unreachable at ${client.baseUrl}: ${message(err)}`);
    }
    if (!keyOk) throw new KeyCheckError("SpoolEase key validation failed");

    onEvent({ type: "stage", stage: "custom-filaments" });
    try {
      const { status, body } = await client.setCustomFilamentsCsv(buildCustomFilamentsCsv(profiles));
      if (status >= 400) {
        onEvent({ type: "warning", message: `Failed to set custom filaments CSV: ${status} ${body}` });
        csvError = `custom filaments CSV: HTTP ${status}: ${body.slice(0, DETAIL_LIMIT)}`;
      }
    } catch (err) {
      onEvent({ type: "warning", message: `Failed to set custom filaments CSV: ${message(err)}` });
      csvError = `custom filaments CSV: ${message(err)}`;
    }
  }

  onEvent({ type: "stage", stage: "spools" });
  const outcomes: { status: Status; detail: string }[] = [];
  for (const [index, profile] of profiles.entries()) {
    let outcome: { status: Status; detail: string };
    if (dryRun) {
      outcome = { status: "planned", detail: "dry-run" };
    } else if (csvError) {
      // Spools reference filament codes from the CSV, so creating them after a CSV failure would leave SpoolEase half-configured.
      outcome = { status: "failed", detail: csvError };
    } else {
      try {
        const { status, body } = await client.addOrEditSpool(profile);
        outcome = { status: status < 400 ? "written" : "failed", detail: `HTTP ${status}: ${body.slice(0, DETAIL_LIMIT)}` };
      } catch (err) {
        outcome = { status: "failed", detail: `request error: ${message(err)}` };
      }
    }
    outcomes.push(outcome);
    onEvent({ type: "spool", index, ...outcome });
  }
  return outcomes;
}
