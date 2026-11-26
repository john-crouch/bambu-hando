// ABOUTME: The Presets tab's side work: reading a preset file, SpoolEase's nozzle range, and saving edits.
// ABOUTME: Each command reports back with one of the tab's own messages; the update decides what it means.

import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { nozzleTypeFor, readBambuStudioConf } from "../../../bambuProfiles.js";
import { errorMessage } from "../../../errors.js";
import { bambuConfigDir } from "../../../paths.js";
import {
  type EditResult,
  type Edits,
  type Preset,
  writePresetTargets,
} from "../../../presetEdit.js";
import { SpoolEaseClient, type SpoolEaseConnection, withNozzleRange } from "../../../spoolease.js";
import { checkKey, KeyCheckError } from "../../../sync.js";
import type { Cmd } from "../../core/program.js";
import { type AppMsg, type TabMsg, toTab } from "../../core/types.js";

/** SpoolEase's custom filament whose nozzle range a save changes too. */
export interface RangeChange {
  code: string;
  from: string;
  to: string;
  low: number;
  high: number;
}

/** What the review knows about SpoolEase's nozzle range for the filament. */
export type RangeState =
  | { state: "none" }
  | { state: "checking" }
  | { state: "change"; change: RangeChange }
  | { state: "warning"; warning: string };

export interface SpoolEaseOutcome {
  ok: boolean;
  line: string;
}

/** A preset file read; `printer` is the printer it was read for (to open it), absent for the detail panel. */
export type PresetFileMsg =
  | { type: "presets/read"; path: string; printer?: string; preset: Preset; nozzleType?: string }
  | { type: "presets/read"; path: string; printer?: string; error: string };

export interface RangeMsg {
  type: "presets/range";
  path: string;
  range: RangeState;
}

export interface SavedMsg {
  type: "presets/saved";
  path: string;
  results: EditResult[];
  spoolease: SpoolEaseOutcome | null;
  /** SpoolEase rejected the key or couldn't be reached: a setup error. */
  setupError: boolean;
}

function toPresets(msg: PresetFileMsg | RangeMsg | SavedMsg): AppMsg {
  return toTab("presets", msg as unknown as TabMsg);
}

export function rangeText(low: number | null, high: number | null): string {
  return `${low ?? "?"}–${high ?? "?"}°C`;
}

/** Reads a preset file (it must hold a JSON object); given its printer, BambuStudio's nozzle type for it too. */
export function readPresetCmd(path: string, printer?: string): Cmd<AppMsg> {
  return async (dispatch) => {
    const read = {
      type: "presets/read" as const,
      path,
      ...(printer === undefined ? {} : { printer }),
    };
    try {
      const preset: unknown = JSON.parse(await readFile(path, "utf-8"));
      if (typeof preset !== "object" || preset === null || Array.isArray(preset))
        throw new Error("it isn't a preset");
      const nozzleType =
        printer === undefined
          ? undefined
          : nozzleTypeFor((await readBambuStudioConf(bambuConfigDir())).nozzleTypes, printer);
      dispatch(
        toPresets({
          ...read,
          preset: preset as Preset,
          ...(nozzleType ? { nozzleType } : {}),
        }),
      );
    } catch (err) {
      dispatch(
        toPresets({
          ...read,
          error: `Couldn't read ${basename(path)}: ${errorMessage(err)}`,
        }),
      );
    }
  };
}

/** Whether SpoolEase lists `code` with another nozzle range than `range`. */
export function rangeCmd(
  path: string,
  code: string,
  range: { low: number; high: number },
  connection: SpoolEaseConnection,
): Cmd<AppMsg> {
  return async (dispatch) => {
    let state: RangeState;
    try {
      const client = new SpoolEaseClient(connection);
      await checkKey(client);
      const listed = (await client.getCustomFilaments()).get(code);
      const same = listed?.nozzleTempMin === range.low && listed?.nozzleTempMax === range.high;
      state =
        listed && !same
          ? {
              state: "change",
              change: {
                code,
                from: rangeText(listed.nozzleTempMin, listed.nozzleTempMax),
                to: rangeText(range.low, range.high),
                ...range,
              },
            }
          : { state: "none" };
    } catch (err) {
      state = {
        state: "warning",
        warning: `Couldn't read SpoolEase, so its nozzle range for ${code} stays as it is: ${errorMessage(err)}`,
      };
    }
    dispatch(toPresets({ type: "presets/range", path, range: state }));
  };
}

/** Writes each target its edits, then SpoolEase's nozzle range when it changes and a preset was saved. */
export function saveCmd(
  path: string,
  writes: readonly { path: string; edits: Edits }[],
  change: RangeChange | null,
  connection: SpoolEaseConnection | null,
): Cmd<AppMsg> {
  return async (dispatch) => {
    const results = await writePresetTargets(writes);
    let spoolease: SpoolEaseOutcome | null = null;
    let setupError = false;
    if (change && connection && results.some((r) => r.ok)) {
      try {
        const client = new SpoolEaseClient(connection);
        await checkKey(client);
        // Read again just before writing: SpoolEase replaces the whole CSV on every write.
        const csv = withNozzleRange(
          await client.getCustomFilamentsCsv(),
          change.code,
          change.low,
          change.high,
        );
        if (csv === null)
          spoolease = {
            ok: false,
            line: `SpoolEase no longer lists ${change.code}; nothing changed there`,
          };
        else {
          const written = await client.setCustomFilamentsCsv(csv);
          spoolease = written.ok
            ? { ok: true, line: `SpoolEase's nozzle range for ${change.code} is ${change.to}` }
            : { ok: false, line: `SpoolEase didn't take the nozzle range: ${written.error}` };
        }
      } catch (err) {
        setupError = err instanceof KeyCheckError;
        spoolease = {
          ok: false,
          line: `Couldn't change SpoolEase's nozzle range: ${errorMessage(err)}`,
        };
      }
    }
    dispatch(toPresets({ type: "presets/saved", path, results, spoolease, setupError }));
  };
}
