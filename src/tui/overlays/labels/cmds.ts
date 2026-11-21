// ABOUTME: The labels overlay's side work: reading the saved label choices and the printers, and making the labels.
// ABOUTME: Making labels reports its outcome to the session itself (toast, run summary), so closing early loses nothing.

import { basename } from "node:path";

import { errorMessage } from "../../../errors.js";
import { type LabelTarget, makeLabels } from "../../../labelJob.js";
import { listPrinters } from "../../../labelPdf.js";
import {
  type LabelSettings,
  loadLabelSettings,
  saveLabelSettings,
} from "../../../labelSettings.js";
import { SpoolEaseClient, type SpoolEaseConnection } from "../../../spoolease.js";
import { checkKey, KeyCheckError } from "../../../sync.js";
import type { Cmd } from "../../core/program.js";
import type { AppMsg, RunSummary } from "../../core/types.js";
import { plural } from "../../ui/format.js";

/** The remembered choices and the CUPS destinations (none without CUPS). */
export function loadLabelsCmd(): Cmd<AppMsg> {
  return async (dispatch) => {
    const [settings, printers] = await Promise.all([loadLabelSettings(), listPrinters()]);
    dispatch({ type: "overlay", msg: { type: "labels/loaded", settings, printers } });
  };
}

/**
 * Makes the labels, then always remembers the choices (even when the labels failed, so a retry starts
 * from them), and reports: a toast, a run summary (a failed print or PDF is a failed run), then
 * labels/made so the overlay closes.
 */
export function makeLabelsCmd(
  conn: SpoolEaseConnection,
  spoolIds: string[],
  target: LabelTarget,
  settings: LabelSettings,
): Cmd<AppMsg> {
  return async (dispatch) => {
    const lines: string[] = [];
    const failures: string[] = [];
    let exitCode: 1 | 2 = 1;
    let count = "";
    const done: string[] = [];
    try {
      const client = new SpoolEaseClient(conn);
      await checkKey(client);
      const made = await makeLabels(
        client,
        { ids: spoolIds, brand: "", material: "", match: "" },
        target,
        (warning) => lines.push(warning),
      );
      count = plural(made.spools.length, "label");
      if (target.output) {
        lines.push(`Wrote ${count} to ${target.output}`);
        done.push(`saved to ${basename(target.output)}`);
      }
      if (made.printError) failures.push(made.printError);
      else if (target.printer) {
        lines.push(
          `Sent ${count} to ${target.printer}${made.printReply ? `: ${made.printReply}` : ""}`,
        );
        done.unshift(`sent to ${target.printer}`);
      }
    } catch (err) {
      if (err instanceof KeyCheckError) exitCode = 2;
      failures.push(`Labels failed: ${errorMessage(err)}`);
    }
    lines.push(...failures);
    try {
      await saveLabelSettings(settings);
    } catch (err) {
      lines.push(`Couldn't remember these label choices: ${errorMessage(err)}`);
    }
    const ok = failures.length === 0;
    const summary: RunSummary = ok ? { ok, lines } : { ok, lines, exitCode };
    dispatch({
      type: "app/toast",
      text: ok ? `${count} ${done.join(" and ")}` : (failures[0] ?? "Labels failed"),
      tone: ok ? "ok" : "failed",
    });
    dispatch({ type: "app/runFinished", summary });
    dispatch({ type: "overlay", msg: { type: "labels/made" } });
  };
}
