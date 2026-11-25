// ABOUTME: The Add tab's side work for importing your 3DFilamentProfiles spools: the list, the review's preparation and the run.
// ABOUTME: Each reports back with the tab's own messages; errors become messages, never throws, and no key is ever in one.

import { QuotaError } from "../../../apiQuota.js";
import { errorMessage } from "../../../errors.js";
import { FilamentCatalog } from "../../../filamentCatalog.js";
import { FilamentProfilesError, MAX_BULK_UPDATES } from "../../../filamentProfiles.js";
import { connectFilamentProfiles, MissingKeyError } from "../../../filamentProfilesConnect.js";
import { tildePath } from "../../../paths.js";
import { type ProfilePlan, previewPlan } from "../../../planPreview.js";
import { KeyringError } from "../../../secrets.js";
import { SpoolEaseClient } from "../../../spoolease.js";
import { KeyCheckError, SetupError, type SyncEvent } from "../../../sync.js";
import { applyImport, type ImportOutcome, type PreparedImport } from "../../../tdfpImport.js";
import {
  type ImportPreviewRow,
  prepareFromApi,
  previewImport,
  readImportBasis,
  saveImportLinks,
} from "../../../tdfpImportSession.js";
import { saveTuiSettings } from "../../../tuiSettings.js";
import type { Cmd } from "../../core/program.js";
import type { AppMsg } from "../../core/types.js";
import type { FormValues } from "../../core/values.js";
import { addMsg } from "./cmds.js";
import { consoleOf, printersOf } from "./targets.js";

/** What fixes a failed read: storing a 3DFP key, the SpoolEase settings, or trying again. */
export type TdfpProblem = "noKey" | "spoolease" | "other";

/** A spool as the run left it, for Done and the session summary. */
export interface TdfpOutcome {
  code: string;
  name: string;
  /** "#RRGGBB" */
  swatch: string;
  filamentId: string;
  /** The SpoolEase spool made for it; null when it failed. */
  spoolId: string | null;
  error: string | null;
  /** Imported, but its SpoolEase ID didn't reach 3DFP. */
  warning: string | null;
}

export type TdfpMsg =
  | {
      type: "add/tdfpListed";
      /** The console the list was read for (consoleKey). */
      console: string;
      rows: ImportPreviewRow[];
      linked: number;
      warnings: string[];
    }
  | { type: "add/tdfpListFailed"; console: string; error: string; problem: TdfpProblem }
  | {
      type: "add/tdfpPrepared";
      seq: number;
      prepared: PreparedImport;
      /** What the run does to each item's presets and custom filament; null when that couldn't be read. */
      plans: ProfilePlan[] | null;
      /** API calls reading took (the list when it wasn't cached, records, calibrations). */
      calls: number;
      /** API calls applying takes (writing the SpoolEase IDs). */
      linkCalls: number;
      warnings: string[];
    }
  | { type: "add/tdfpPrepareFailed"; seq: number; error: string; problem: TdfpProblem }
  | { type: "add/tdfpRunEvent"; event: SyncEvent }
  | {
      type: "add/tdfpApplied";
      outcomes: TdfpOutcome[];
      /** API calls applying took. */
      calls: number;
      /** Whether any BambuStudio preset was written: BambuStudio shows them after a restart. */
      wrotePresets: boolean;
      warnings: string[];
    }
  | { type: "add/tdfpApplyFailed"; error: string; exitCode: 1 | 2 }
  /** From the command palette. */
  | { type: "add/openTdfp" };

/** The console a list was read for: the links are kept per console. "" when none is set up. */
export function consoleKey(values: FormValues): string {
  const connection = consoleOf(values);
  return connection
    ? `${connection.https ? "https" : "http"}://${connection.host}:${connection.port}`
    : "";
}

function problemOf(err: unknown): TdfpProblem {
  // A keyring that can't be read is fixed the same way: unlock it, or give the key another way.
  if (err instanceof MissingKeyError || err instanceof KeyringError) return "noKey";
  if (err instanceof KeyCheckError) return "spoolease";
  return "other";
}

const NO_CONSOLE = "SpoolEase isn't set up: importing makes a SpoolEase spool for each 3DFP spool";

/**
 * The account's 3DFP spools not linked to this console yet, each with what importing it writes as far as the
 * local catalog tells (no API call beyond the list, which is cached for an hour).
 */
export function tdfpListCmd(values: FormValues): Cmd<AppMsg> {
  return async (dispatch) => {
    const console = consoleKey(values);
    const connection = consoleOf(values);
    const fail = (error: string, problem: TdfpProblem) =>
      dispatch(addMsg({ type: "add/tdfpListFailed", console, error, problem }));
    if (!connection) {
      fail(NO_CONSOLE, "spoolease");
      return;
    }
    try {
      const api = await connectFilamentProfiles();
      const basis = await readImportBasis(api, connection);
      const catalog = FilamentCatalog.open();
      try {
        const { rows, linked } = await previewImport(basis, catalog, new Date());
        dispatch(
          addMsg({
            type: "add/tdfpListed",
            console,
            rows,
            linked,
            warnings: basis.linkWarning ? [basis.linkWarning] : [],
          }),
        );
      } finally {
        catalog.close();
      }
    } catch (err) {
      fail(errorMessage(err), problemOf(err));
    }
  };
}

/** What importing these spools writes: records catalog first, the spools' own calibration, and the plan on disk and SpoolEase. */
export function tdfpPrepareCmd(seq: number, codes: string[], values: FormValues): Cmd<AppMsg> {
  return async (dispatch) => {
    const fail = (error: string, problem: TdfpProblem) =>
      dispatch(addMsg({ type: "add/tdfpPrepareFailed", seq, error, problem }));
    const connection = consoleOf(values);
    if (!connection) {
      fail(NO_CONSOLE, "spoolease");
      return;
    }
    try {
      const api = await connectFilamentProfiles();
      const basis = await readImportBasis(api, connection);
      const read = await prepareFromApi(api, basis, codes);
      const warnings = [...(basis.linkWarning ? [basis.linkWarning] : []), ...read.warnings];
      let plans: ProfilePlan[] | null = null;
      try {
        const csv = await new SpoolEaseClient(connection).getCustomFilamentsCsv();
        plans = await previewPlan(
          read.prepared.items.map((item) => item.profile),
          { presetFolder: values.presetFolder.trim(), printers: printersOf(values) },
          { csv, spooledIds: new Set() },
          false,
          { overwrite: values.overwritePresets },
        );
      } catch (err) {
        warnings.push(`Couldn't look for what's there already: ${errorMessage(err)}`);
      }
      dispatch(
        addMsg({
          type: "add/tdfpPrepared",
          seq,
          prepared: read.prepared,
          plans,
          calls: (basis.fromCache ? 0 : 1) + read.calls,
          linkCalls: Math.ceil(read.prepared.items.length / MAX_BULK_UPDATES),
          warnings,
        }),
      );
    } catch (err) {
      fail(errorMessage(err), problemOf(err));
    }
  };
}

function outcomeOf(outcome: ImportOutcome): TdfpOutcome {
  const { profile } = outcome.item;
  return {
    code: outcome.code,
    name: profile.name,
    swatch: `#${profile.colorRgba.slice(0, 6)}`,
    filamentId: profile.filamentId,
    spoolId: outcome.spoolId,
    error: outcome.spoolId ? null : (outcome.error ?? "not imported"),
    warning: outcome.warning,
  };
}

/** Setup problems ask for exit code 2, as the CLI's: no key, a refused key, no system profiles, the quota. */
function exitCodeOf(err: unknown): 1 | 2 {
  if (
    err instanceof MissingKeyError ||
    err instanceof KeyringError ||
    err instanceof KeyCheckError ||
    err instanceof SetupError ||
    err instanceof QuotaError
  )
    return 2;
  return err instanceof FilamentProfilesError && (err.status === 401 || err.status === 402) ? 2 : 1;
}

/**
 * Remembers the printers, then imports (presets and custom filaments through runSync, a spool per 3DFP spool, the
 * SpoolEase IDs on 3DFP) streaming its stages, and adds the links to the link book as it is by then.
 */
export function tdfpApplyCmd(prepared: PreparedImport, values: FormValues): Cmd<AppMsg> {
  return async (dispatch) => {
    const warnings: string[] = [];
    const failed = (error: string, exitCode: 1 | 2) =>
      dispatch(addMsg({ type: "add/tdfpApplyFailed", error, exitCode }));
    const connection = consoleOf(values);
    if (!connection) {
      failed(NO_CONSOLE, 2);
      return;
    }
    try {
      await saveTuiSettings({ printers: printersOf(values) });
    } catch (err) {
      warnings.push(`Couldn't remember these printers: ${errorMessage(err)}`);
    }
    try {
      const api = await connectFilamentProfiles();
      await api.ledger.ensure(Math.ceil(prepared.items.length / MAX_BULK_UPDATES));
      const applied = await applyImport(prepared, {
        sync: {
          presetFolder: values.presetFolder.trim(),
          printers: printersOf(values),
          dryRun: false,
          overwritePresets: values.overwritePresets,
        },
        connection,
        tdfp: api.client,
        now: new Date(),
        onEvent: (event) => dispatch(addMsg({ type: "add/tdfpRunEvent", event })),
      });
      if (applied.links.length > 0) {
        try {
          const setAside = await saveImportLinks(api, connection.host, applied);
          if (setAside)
            warnings.push(`The unreadable spool link file was kept as ${tildePath(setAside)}`);
        } catch (err) {
          warnings.push(
            `The links couldn't be saved (${errorMessage(err)}): \`bambu-hando 3dfp sync\` finds them by the SpoolEase IDs on 3DFP`,
          );
        }
      }
      dispatch(
        addMsg({
          type: "add/tdfpApplied",
          outcomes: applied.outcomes.map(outcomeOf),
          calls: applied.calls,
          wrotePresets: applied.sync.results.some((r) => r.bambuStatus === "written"),
          warnings,
        }),
      );
    } catch (err) {
      failed(errorMessage(err), exitCodeOf(err));
    }
  };
}
