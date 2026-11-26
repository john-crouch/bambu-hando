// ABOUTME: The Add tab as the shell sees it: SpoolmanDB, a file or your 3DFP spools → empty spool weights → review → done.
// ABOUTME: Wires the model, the pure update, hints and the view into one TabModule.

import type { TabModule } from "../../core/types.js";
import { type AddModel, init } from "./model.js";
import { busy, capturesText, commands, hints, modal, unsaved, update } from "./update.js";
import { AddView, addDialog } from "./View.js";

export type { AddModel } from "./model.js";

/*
 * Deep links (app/switchTab focus) this tab accepts: a filament ID, or "id:<filamentId>|name:<name>" (Find opens on
 * it, ticked), or "3dfp" (Find opens on your 3DFilamentProfiles spools).
 */

export const addTab: TabModule<AddModel> = {
  id: "add",
  title: "Add",
  init,
  update,
  View: AddView,
  dialog: addDialog,
  hints,
  capturesText,
  busy,
  modal,
  unsaved,
  commands,
};
