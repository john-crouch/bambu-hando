// ABOUTME: Shared data models for normalized filament profiles and sync results.
// ABOUTME: Keeps parsing and integration logic decoupled from transport details.

import type { SourceIds } from "./filamentDb.js";
import type { PresetSettings } from "./presetSettings.js";

/** Normalized filament profile used by both BambuStudio and SpoolEase flows. */
export interface FilamentProfile {
  name: string;
  brand: string;
  material: string;
  colorName: string;
  /** 8-char uppercase RRGGBBAA hex. */
  colorRgba: string;
  nozzleTempMin: number;
  nozzleTempMax: number;
  density: number;
  diameter: number;
  slicerFilamentCode: string;
  /**
   * The one ID that links all three systems: BambuStudio preset `filament_id`, SpoolEase
   * custom-filament CSV code, and SpoolEase spool `slicer_filament`.
   */
  filamentId: string;
  /** Advertised net filament weight in whole grams; 0 = unknown (SpoolEase stores no value). */
  labelWeight: number;
  /** Empty spool (core) weight in whole grams; 0 = unknown. */
  coreWeight: number;
  /** Print settings from the source for its presets; what it leaves out keeps the Generic template's values. */
  settings?: PresetSettings;
  /** The user's own calibration among those settings (a 3DFP spool's): it goes over a manufacturer's values too. */
  calibration?: PresetSettings;
  /** The source's ids for the filament, by which filament-db's export finds its product line. */
  sourceIds?: SourceIds;
}

// written: change applied; planned: dry-run only; skipped: integration disabled; failed: attempted and rejected.
export type Status = "written" | "planned" | "skipped" | "failed";

/** Per-profile operation status with optional details. */
export interface SyncResult {
  profileName: string;
  filamentId: string;
  bambuStatus: Status;
  spooleaseStatus: Status;
  detail: string;
  /** Empty spool weight a new spool gets (0 = unspecified); null when the run creates no spools. */
  coreWeight: number | null;
  /** ID SpoolEase gave the spool this run created; null when it created none for this profile. */
  spoolId: string | null;
}

export function resultFailed(result: SyncResult): boolean {
  return result.bambuStatus === "failed" || result.spooleaseStatus === "failed";
}
