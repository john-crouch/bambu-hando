// ABOUTME: The Add tab as the shell sees it: SpoolmanDB or an import → empty spool weights → review → run → done.
// ABOUTME: Wires the model, the pure update, hints and the view into one TabModule.

import type { TabModule } from "../../core/types.js";
import { type AddModel, init } from "./model.js";
import { capturesText, commands, hints, update } from "./update.js";
import { AddView } from "./View.js";

export type { AddModel } from "./model.js";

export const addTab: TabModule<AddModel> = {
  id: "add",
  title: "Add",
  init,
  update,
  View: AddView,
  hints,
  capturesText,
  commands,
};
