// ABOUTME: The Settings tab as the shell loads it: the model and update from model.ts with the view from View.tsx.
// ABOUTME: BambuStudio, SpoolEase, label and import settings, each change applied at once.

/*
 * Deep links (app/switchTab focus) this tab accepts, opening that page on that row (fields.ts FOCUS_ROWS):
 * "bambu.folder" | "bambu.printers" | "bambu.overwrite",
 * "spoolease.host" | "spoolease.port" | "spoolease.key" | "spoolease.https" | "spoolease.skip" (Use SpoolEase)
 *   | "spoolease.spools",
 * "labels.fields" | "labels.size" | "labels.printer" | "labels.output",
 * "import.source" | "import.diameter",
 * or a page id alone ("bambu" | "spoolease" | "labels" | "import"), which keeps that page's cursor.
 * Every visit also reads labels.json again, since the labels overlay saves there too.
 */

import type { TabModule } from "../../core/types.js";
import { type SettingsModel, settingsLogic } from "./model.js";
import { SettingsView } from "./View.js";

export const settingsTab: TabModule<SettingsModel> = { ...settingsLogic, View: SettingsView };
