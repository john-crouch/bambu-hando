// ABOUTME: The Check tab as the shell loads it: the model and update from model.ts with the view from View.tsx.
// ABOUTME: Compares BambuStudio presets with the console's custom filaments and spools, and gives presets IDs.

import type { TabModule } from "../../core/types.js";
import { type CheckModel, checkLogic } from "./model.js";
import { CheckView } from "./View.js";

export const checkTab: TabModule<CheckModel> = { ...checkLogic, View: CheckView };
