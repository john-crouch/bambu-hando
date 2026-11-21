// ABOUTME: The Settings tab as the shell loads it: the model and update from model.ts with the view from View.tsx.
// ABOUTME: BambuStudio, SpoolEase, label and import settings, each change applied at once.

import type { TabModule } from "../../core/types.js";
import { type SettingsModel, settingsLogic } from "./model.js";
import { SettingsView } from "./View.js";

export const settingsTab: TabModule<SettingsModel> = { ...settingsLogic, View: SettingsView };
