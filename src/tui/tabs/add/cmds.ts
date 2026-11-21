// ABOUTME: The Add tab's side work: import a file or URL, read SpoolEase's spool weights, preview the plan, run the sync.
// ABOUTME: Each command reports back with the tab's own messages; errors become messages, never throws.

import { access } from "node:fs/promises";

import { SystemProfiles } from "../../../bambuProfiles.js";
import { buildPreset, presetPath } from "../../../bambuStudio.js";
import { errorMessage } from "../../../errors.js";
import type { FilamentProfile, SyncResult } from "../../../models.js";
import { bambuConfigDir } from "../../../paths.js";
import { type ConsoleState, type ProfilePlan, previewPlan } from "../../../planPreview.js";
import type { Edits, Preset } from "../../../presetEdit.js";
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
  | {
      type: "add/weightsRead";
      signature: string;
      entries: SpoolWeightEntry[];
      warnings: string[];
      /** Filament IDs the console has spools of: the run makes none for them. */
      spooled: string[];
    }
  | { type: "add/weightsFailed"; signature: string; error: string; keyRejected: boolean }
  | { type: "add/planRead"; seq: number; plans: ProfilePlan[] | null; warnings: string[] }
  | { type: "add/runEvent"; event: SyncEvent }
  | { type: "add/runDone"; results: SyncResult[] }
  | { type: "add/runFailed"; error: string; exitCode: 1 | 2 }
  /** The preset the run would write for a row, built for the editor (e on Review). */
  | {
      type: "add/plannedPreset";
      seq: number;
      filamentId: string;
      name: string;
      printer: string;
      path: string;
      original: Preset;
    }
  | { type: "add/plannedPresetFailed"; seq: number; error: string }
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
  "add/plannedPreset",
  "add/plannedPresetFailed",
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

/**
 * SpoolEase's spool catalog and the user's own list, after checking the key (a wrong key would read as
 * empty lists), and which filaments have spools already. An unreadable spool list counts as none, so
 * every brand is still asked.
 */
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
      const [{ entries, warnings }, spooled] = await Promise.all([
        readSpoolWeights(client),
        client.listSpoolFilamentIds().catch(() => new Set<string>()),
      ]);
      dispatch(
        addMsg({ type: "add/weightsRead", signature, entries, warnings, spooled: [...spooled] }),
      );
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

/**
 * The preset the run would write for the profile, for the editor: for the first printer whose preset
 * the run writes (all of them when overwriting; else those without a file yet), built as runSync builds it.
 */
export function plannedPresetCmd(
  seq: number,
  profile: FilamentProfile,
  values: FormValues,
): Cmd<AppMsg> {
  return async (dispatch) => {
    const fail = (error: string) =>
      dispatch(addMsg({ type: "add/plannedPresetFailed", seq, error }));
    const folder = values.presetFolder.trim();
    const printers = printersOf(values);
    const found = await Promise.all(
      printers.map((printer) =>
        access(presetPath(profile, folder, printer)).then(
          () => true,
          () => false,
        ),
      ),
    );
    const printer = printers.find((_, i) => values.overwritePresets || !found[i]);
    if (printer === undefined) {
      fail(
        `${profile.name}'s presets are already there and the run keeps them: edit them in the Presets tab`,
      );
      return;
    }
    let system: SystemProfiles;
    try {
      system = await SystemProfiles.load(bambuConfigDir());
    } catch (err) {
      fail(errorMessage(err));
      return;
    }
    const template = system.template(profile.material, printer);
    if (!template) {
      fail(`BambuStudio has no Generic ${profile.material} preset for ${printer}`);
      return;
    }
    dispatch(
      addMsg({
        type: "add/plannedPreset",
        seq,
        filamentId: profile.filamentId,
        name: profile.name,
        printer,
        path: presetPath(profile, folder, printer),
        original: buildPreset(profile, printer, template, system.version),
      }),
    );
  };
}
