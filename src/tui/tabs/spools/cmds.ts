// ABOUTME: The Spools tab's side work: reading and learning barcodes, and adding copies of a spool to SpoolEase.
// ABOUTME: Each command reports back with the tab's own messages; the update decides what the session sees.

import { type BarcodeFilament, loadBarcodes, rememberBarcode } from "../../../barcodes.js";
import { errorMessage } from "../../../errors.js";
import { addSpoolCopies, type CopyableFilament } from "../../../spoolCopies.js";
import { SpoolEaseClient, type SpoolEaseConnection } from "../../../spoolease.js";
import { checkKey, KeyCheckError } from "../../../sync.js";
import type { Cmd } from "../../core/program.js";
import { type AppMsg, toTab } from "../../core/types.js";

/** Reads barcodes.json; a damaged or missing file is no barcodes. */
export function loadBarcodesCmd(): Cmd<AppMsg> {
  return async (dispatch) => {
    dispatch(toTab("spools", { type: "spools/barcodes", barcodes: await loadBarcodes() }));
  };
}

export function rememberBarcodeCmd(barcode: string, filament: BarcodeFilament): Cmd<AppMsg> {
  return async (dispatch) => {
    try {
      await rememberBarcode(barcode, filament);
      dispatch(toTab("spools", { type: "spools/remembered", barcode, filament }));
    } catch (err) {
      dispatch(
        toTab("spools", { type: "spools/rememberFailed", barcode, error: errorMessage(err) }),
      );
    }
  };
}

/**
 * Checks the key, then adds `count` copies of the filament's newest spool one at a time, reporting each
 * (spools/copy) and then all of them (spools/copiesDone). A rejected key or an unreachable console sends
 * nothing and reports exit code 2, as the headless CLI does.
 */
export function addCopiesCmd(
  conn: SpoolEaseConnection,
  filament: CopyableFilament,
  count: number,
  run: number,
): Cmd<AppMsg> {
  return async (dispatch) => {
    const client = new SpoolEaseClient(conn);
    try {
      await checkKey(client);
    } catch (err) {
      dispatch(
        toTab("spools", {
          type: "spools/copiesDone",
          run,
          results: [],
          error: errorMessage(err),
          exitCode: err instanceof KeyCheckError ? 2 : 1,
        }),
      );
      return;
    }
    const results = await addSpoolCopies(client, filament, count, (_, result) =>
      dispatch(toTab("spools", { type: "spools/copy", run, result })),
    );
    dispatch(toTab("spools", { type: "spools/copiesDone", run, results, error: "" }));
  };
}
