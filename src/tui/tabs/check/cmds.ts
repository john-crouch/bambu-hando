// ABOUTME: The Check tab's side work: writing derived filament IDs into BambuStudio presets that have none.
// ABOUTME: Reports each file's result back as check/idsWritten; the update turns it into the run's outcome.

import { errorMessage } from "../../../errors.js";
import { fixPresetIds, type IdFix, type IdFixResult } from "../../../presetIds.js";
import type { Cmd } from "../../core/program.js";
import { type AppMsg, toTab } from "../../core/types.js";

export function writeIds(fixes: IdFix[]): Cmd<AppMsg> {
  return async (dispatch) => {
    let results: IdFixResult[];
    try {
      results = await fixPresetIds(fixes);
    } catch (err) {
      results = fixes.map((fix) => ({ ...fix, ok: false, detail: errorMessage(err) }));
    }
    dispatch(toTab("check", { type: "check/idsWritten", results }));
  };
}
