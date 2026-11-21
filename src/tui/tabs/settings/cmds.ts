// ABOUTME: The Settings tab's side work: reading BambuStudio's folders and printers, CUPS printers and label settings,
// ABOUTME: saving remembered choices (the console key in the keyring), and testing the console; replies as settings/* messages.

import { readdir } from "node:fs/promises";

import { SystemProfiles } from "../../../bambuProfiles.js";
import { errorMessage } from "../../../errors.js";
import { listPrinters } from "../../../labelPdf.js";
import {
  type LabelSettings,
  loadLabelSettings,
  updateLabelSettings,
} from "../../../labelSettings.js";
import { bambuConfigDir, bambuUserRoot } from "../../../paths.js";
import { keyringName, removeSecret, SECRETS, storeSecret } from "../../../secrets.js";
import { SpoolEaseClient, type SpoolEaseConnection } from "../../../spoolease.js";
import { consoleKey } from "../../../spooleaseConfig.js";
import { rememberConsole, type SavedConsole, saveTuiSettings } from "../../../tuiSettings.js";
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

/** Remembers a change to the console's host, port or HTTPS; a failure is a warning, the session keeps it. */
export function saveConsole(change: SavedConsole): Cmd<AppMsg> {
  return async (dispatch) => {
    try {
      await rememberConsole(change);
    } catch (err) {
      dispatch({
        type: "app/toast",
        text: `Couldn't remember the console: ${errorMessage(err)}`,
        tone: "warning",
      });
    }
  };
}

/** Stores the console's key in the keyring; when it can't, the session keeps it. Never says the key. */
export function saveKey(key: string): Cmd<AppMsg> {
  const spec = SECRETS.spoolease;
  return async (dispatch) => {
    try {
      await storeSecret(spec, key);
    } catch (err) {
      dispatch({
        type: "app/toast",
        text: `SpoolEase key kept for this session only: ${errorMessage(err)}`,
        tone: "warning",
      });
      return;
    }
    const overridden = process.env[spec.env]?.trim()
      ? `; ${spec.env} overrides it while it's set`
      : "";
    dispatch({
      type: "app/toast",
      text: `SpoolEase key saved in ${keyringName()}${overridden}`,
      tone: "ok",
    });
  };
}

/**
 * Reads the key the console at `host` has saved (a session that skipped SpoolEase never read the keyring), and
 * replies with it for that host; an unusable one is a warning that names where it came from, never what it is.
 */
export function loadStoredKey(host: string): Cmd<AppMsg> {
  return async (dispatch) => {
    try {
      const key = await consoleKey(host);
      if (key) dispatch(reply({ type: "settings/storedKey", host, key }));
    } catch (err) {
      dispatch({
        type: "app/toast",
        text: `Couldn't load the saved SpoolEase key: ${errorMessage(err)}`,
        tone: "warning",
      });
    }
  };
}

/** Removes the console's key from the keyring, saying whether one was there. */
export function forgetKey(): Cmd<AppMsg> {
  return async (dispatch) => {
    try {
      const removed = await removeSecret(SECRETS.spoolease);
      dispatch({
        type: "app/toast",
        text: removed
          ? `SpoolEase key removed from ${keyringName()}`
          : `SpoolEase key cleared for this session; none was stored in ${keyringName()}`,
        tone: "ok",
      });
    } catch (err) {
      dispatch({
        type: "app/toast",
        text: `Couldn't forget the stored SpoolEase key: ${errorMessage(err)}`,
        tone: "warning",
      });
    }
  };
}

/**
 * Saves a change to the label settings, merged into labels.json as it is now (the labels overlay saves
 * there too), then reports what was saved, so the tab shows the file's settings, not a stale copy.
 */
export function saveLabels(change: Partial<LabelSettings>): Cmd<AppMsg> {
  return async (dispatch) => {
    try {
      dispatch(
        reply({
          type: "settings/loaded",
          what: "labels",
          value: await updateLabelSettings(change),
        }),
      );
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
