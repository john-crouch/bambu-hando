// ABOUTME: The Check tab as the shell loads it: the model and update from model.ts with the view from View.tsx.
// ABOUTME: Compares BambuStudio presets with the console's custom filaments and spools, and gives presets IDs.

/*
 * Deep links (app/switchTab focus) this tab accepts: a section key, which opens that section with its items
 * focused: "csvOnly" | "unknownCode" | "badRows" | "presetsOnly" | "presetsNoId" | "noCode". A running ID
 * write keeps its review on screen instead.
 *
 * Deep links it sends, enter on an item: add <filament ID> (a SpoolEase filament or preset to sync, a spool's
 * unknown code), spools <spool id> (a spool without a code), settings "spoolease.host" (or "spoolease.skip"
 * while SpoolEase is skipped) when there's no console or it can't be read.
 */

import type { TabModule } from "../../core/types.js";
import { type CheckModel, checkLogic } from "./model.js";
import { CheckView } from "./View.js";

export const checkTab: TabModule<CheckModel> = { ...checkLogic, View: CheckView };
