// ABOUTME: The Settings tab's side work: reading BambuStudio's folders and printers, CUPS printers and label settings,
// ABOUTME: saving remembered choices, and testing the SpoolEase connection; each reports back as a settings/* message.

import { readdir } from "node:fs/promises";

import { SystemProfiles } from "../../../bambuProfiles.js";
import { errorMessage } from "../../../errors.js";
import { listPrinters } from "../../../labelPdf.js";
import {
  type LabelSettings,
  loadLabelSettings,
  saveLabelSettings,
} from "../../../labelSettings.js";
import { bambuConfigDir, bambuUserRoot } from "../../../paths.js";
import { SpoolEaseClient, type SpoolEaseConnection } from "../../../spoolease.js";
import { saveTuiSettings } from "../../../tuiSettings.js";
import type { Cmd } from "../../core/program.js";
import { type AppMsg, toTab } from "../../core/types.js";
import { consoleUrl } from "../../ui/index.js";
import type { Sources } from "./fields.js";

export type LoadWhat = keyof Sources;

const reply = (msg: Record<string, unknown> & { type: string }): AppMsg => toTab("settings", msg);

function load<T>(what: LoadWhat, read: () => Promise<T>): Cmd<AppMsg> {
  return async (dispatch) => {
    try {
      dispatch(reply({ type: "settings/loaded", what, value: await read() }));
    } catch (err) {
      dispatch(reply({ type: "settings/loaded", what, error: errorMessage(err) }));
    }
  };
}

/** BambuStudio's user folders; none when it has no user/ directory yet. */
export const loadFolders = (): Cmd<AppMsg> =>
  load("folders", async () => {
    const entries = await readdir(bambuUserRoot(), { withFileTypes: true }).catch(() => []);
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  });

export const loadPrinters = (): Cmd<AppMsg> =>
  load("printers", async () => (await SystemProfiles.load(bambuConfigDir())).printers());

export const loadLabelPrinters = (): Cmd<AppMsg> => load("labelPrinters", listPrinters);

export const loadLabels = (): Cmd<AppMsg> => load("labels", () => loadLabelSettings());

/** Remembers the printers for the next session; a failure is a warning, the session keeps them. */
export function savePrinters(printers: string[]): Cmd<AppMsg> {
  return async (dispatch) => {
    try {
      await saveTuiSettings({ printers });
    } catch (err) {
      dispatch({
        type: "app/toast",
        text: `Couldn't remember these printers: ${errorMessage(err)}`,
        tone: "warning",
      });
    }
  };
}

/** Label saves, one after another, so each reads what the one before it wrote. */
let labelSaves: Promise<unknown> = Promise.resolve();

/**
 * Saves a change to the label settings, merged into labels.json as it is now (the labels overlay saves
 * there too), then reports what was saved, so the tab shows the file's settings, not a stale copy.
 */
export function saveLabels(change: Partial<LabelSettings>): Cmd<AppMsg> {
  return async (dispatch) => {
    const save = labelSaves.then(async () => {
      const next = { ...(await loadLabelSettings()), ...change };
      await saveLabelSettings(next);
      return next;
    });
    labelSaves = save.catch(() => undefined);
    try {
      dispatch(reply({ type: "settings/loaded", what: "labels", value: await save }));
    } catch (err) {
      dispatch({
        type: "app/toast",
        text: `Couldn't save the label settings: ${errorMessage(err)}`,
        tone: "warning",
      });
    }
  };
}

/** Asks the console to check the key; seq ties the answer to the settings it was asked with. */
export function testConnection(connection: SpoolEaseConnection, seq: number): Cmd<AppMsg> {
  return async (dispatch) => {
    const url = consoleUrl(connection);
    let ok = false;
    let text: string;
    try {
      ok = await new SpoolEaseClient(connection).testKey();
      text = ok ? `${url} accepts the key` : `${url} rejects the security key`;
    } catch (err) {
      text = `Can't reach ${url}: ${errorMessage(err)}`;
    }
    dispatch(reply({ type: "settings/tested", seq, ok, text }));
  };
}
