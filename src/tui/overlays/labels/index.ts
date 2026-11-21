// ABOUTME: The labels overlay as the shell's OverlayModule: fields, size, printer and PDF for some spools, then the labels.
// ABOUTME: Model and update live in model.ts, the view in View.tsx.

import type { LabelsRequest, OverlayModule } from "../../core/types.js";
import { busy, hints, init, type LabelsModel, update } from "./model.js";
import { LabelsView } from "./View.js";

export const labelsOverlay: OverlayModule<LabelsModel, LabelsRequest> = {
  id: "labels",
  init,
  update,
  View: LabelsView,
  hints,
  busy,
};
