// ABOUTME: Shared data models for normalized filament profiles and sync results.
// ABOUTME: Keeps parsing and integration logic decoupled from transport details.

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
}

// written: change applied; planned: dry-run only; skipped: integration disabled; failed: attempted and rejected.
export type Status = "written" | "planned" | "skipped" | "failed";

/** Per-profile operation status with optional details. */
export interface SyncResult {
  profileName: string;
  bambuStatus: Status;
  spooleaseStatus: Status;
  detail: string;
}

export function resultFailed(result: SyncResult): boolean {
  return result.bambuStatus === "failed" || result.spooleaseStatus === "failed";
}
