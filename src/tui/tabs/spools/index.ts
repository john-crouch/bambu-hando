// ABOUTME: The Spools tab as the shell's TabModule: the console's spools, what's left, labels, more spools and scans.
// ABOUTME: Model and update live in model.ts, the view in View.tsx.

import type { TabModule } from "../../core/types.js";
import {
  busy,
  capturesText,
  commands,
  hints,
  init,
  modal,
  type SpoolsModel,
  update,
} from "./model.js";
import { SpoolsView } from "./View.js";

export const spoolsTab: TabModule<SpoolsModel> = {
  id: "spools",
  title: "Spools",
  init,
  update,
  View: SpoolsView,
  hints,
  capturesText,
  busy,
  modal,
  commands,
};
