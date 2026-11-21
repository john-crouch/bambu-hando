// ABOUTME: The Add tab's side work: import a file or URL, read SpoolEase's spool weights, preview the plan, run the sync.
// ABOUTME: Each command reports back with the tab's own messages; errors become messages, never throws.

import { errorMessage } from "../../../errors.js";
import type { FilamentProfile, SyncResult } from "../../../models.js";
import { type ConsoleState, type ProfilePlan, previewPlan } from "../../../planPreview.js";
import type { Edits } from "../../../presetEdit.js";
import { loadProfiles } from "../../../sources.js";
import { SpoolEaseClient } from "../../../spoolease.js";
import { readSpoolWeights, type SpoolWeightEntry } from "../../../spoolWeights.js";
import { checkKey, KeyCheckError, runSync, SetupError, type SyncEvent } from "../../../sync.js";
import { saveTuiSettings } from "../../../tuiSettings.js";
import type { Cmd } from "../../core/program.js";
import { type AppMsg, toTab } from "../../core/types.js";
import type { FormValues } from "../../core/values.js";
import { consoleOf, createsSpools, printersOf } from "./targets.js";

/** The Add tab's own messages, as its commands send them (wrapped for the shell by toTab). */
export type AddMsg =
  | { type: "add/imported"; source: string; profiles: FilamentProfile[] }
  | { type: "add/importFailed"; source: string; error: string }
  | { type: "add/weightsRead"; signature: string; entries: SpoolWeightEntry[]; warnings: string[] }
  | { type: "add/weightsFailed"; signature: string; error: string; keyRejected: boolean }
  | { type: "add/planRead"; seq: number; plans: ProfilePlan[] | null; warnings: string[] }
  | { type: "add/runEvent"; event: SyncEvent }
  | { type: "add/runDone"; results: SyncResult[] }
  | { type: "add/runFailed"; error: string; exitCode: 1 | 2 }
  /** Edits made to a row's preset before the run writes it (from the preset editor). */
  | { type: "add/planEdits"; filamentId: string; edits: Edits }
  /** From the command palette. */
  | { type: "add/openSearch" }
  | { type: "add/review" }
  | { type: "add/clear" };

export const ADD_MSG_TYPES: ReadonlySet<string> = new Set<AddMsg["type"]>([
  "add/imported",
  "add/importFailed",
  "add/weightsRead",
  "add/weightsFailed",
  "add/planRead",
  "add/runEvent",
  "add/runDone",
  "add/runFailed",
  "add/planEdits",
  "add/openSearch",
  "add/review",
  "add/clear",
]);

export function addMsg(msg: AddMsg): AppMsg {
  return toTab("add", msg as unknown as Parameters<typeof toTab>[1]);
}

/** Profiles from the settings' file or URL. */
export function importCmd(source: string): Cmd<AppMsg> {
  return async (dispatch) => {
    try {
      dispatch(addMsg({ type: "add/imported", source, profiles: await loadProfiles(source) }));
    } catch (err) {
      dispatch(addMsg({ type: "add/importFailed", source, error: errorMessage(err) }));
    }
  };
}

/** SpoolEase's spool catalog and the user's own list, after checking the key (a wrong key would read as empty lists). */
export function weightsCmd(signature: string, values: FormValues): Cmd<AppMsg> {
  return async (dispatch) => {
    const connection = consoleOf(values);
    if (!connection) {
      dispatch(
        addMsg({
          type: "add/weightsFailed",
          signature,
          error: "SpoolEase isn't set up",
          keyRejected: false,
        }),
      );
      return;
    }
    try {
      const client = new SpoolEaseClient(connection);
      await checkKey(client);
      const { entries, warnings } = await readSpoolWeights(client);
      dispatch(addMsg({ type: "add/weightsRead", signature, entries, warnings }));
    } catch (err) {
      dispatch(
        addMsg({
          type: "add/weightsFailed",
          signature,
          error: errorMessage(err),
          keyRejected: err instanceof KeyCheckError,
        }),
      );
    }
  };
}

/** What a run would do to each profile: presets on disk, and the console's CSV and spools when it's set up. Reads only. */
export function planCmd(
  seq: number,
  profiles: FilamentProfile[],
  values: FormValues,
  edits: ReadonlyMap<string, Edits>,
): Cmd<AppMsg> {
  return async (dispatch) => {
    const warnings: string[] = [];
    const connection = consoleOf(values);
    let spoolease: ConsoleState | null = null;
    if (connection) {
      try {
        const client = new SpoolEaseClient(connection);
        await checkKey(client);
        const [csv, spooledIds] = await Promise.all([
          client.getCustomFilamentsCsv(),
          createsSpools(values)
            ? client.listSpoolFilamentIds()
            : Promise.resolve(new Set<string>()),
        ]);
        spoolease = { csv, spooledIds };
      } catch (err) {
        warnings.push(
          `Couldn't read SpoolEase to show what the run changes there: ${errorMessage(err)}`,
        );
      }
    }
    let plans: ProfilePlan[] | null = null;
    try {
      plans = await previewPlan(
        profiles,
        { presetFolder: values.presetFolder.trim(), printers: printersOf(values) },
        spoolease,
        createsSpools(values),
        { overwrite: values.overwritePresets, edits },
      );
    } catch (err) {
      warnings.push(`Couldn't look for existing presets: ${errorMessage(err)}`);
    }
    dispatch(addMsg({ type: "add/planRead", seq, plans, warnings }));
  };
}

/** Remembers the printers, then syncs, streaming every event; a setup error asks for exit code 2. */
export function runCmd(
  profiles: FilamentProfile[],
  values: FormValues,
  edits: ReadonlyMap<string, Edits>,
): Cmd<AppMsg> {
  return async (dispatch) => {
    const event = (e: SyncEvent) => dispatch(addMsg({ type: "add/runEvent", event: e }));
    try {
      await saveTuiSettings({ printers: printersOf(values) });
    } catch (err) {
      event({ type: "warning", message: `Couldn't remember these printers: ${errorMessage(err)}` });
    }
    try {
      const { results } = await runSync(
        {
          profiles,
          presetFolder: values.presetFolder.trim(),
          printers: printersOf(values),
          overwritePresets: values.overwritePresets,
          dryRun: false,
          spoolease: consoleOf(values),
          createSpools: createsSpools(values),
          presetEdits: edits,
        },
        event,
      );
      dispatch(addMsg({ type: "add/runDone", results }));
    } catch (err) {
      dispatch(
        addMsg({
          type: "add/runFailed",
          error: errorMessage(err),
          exitCode: err instanceof KeyCheckError || err instanceof SetupError ? 2 : 1,
        }),
      );
    }
  };
}
