// ABOUTME: The session settings every tab reads: where presets go, which printers, the SpoolEase console, the source.
// ABOUTME: Filled by cli.ts from flags, env, BambuStudio and remembered choices; the Settings tab changes them.

export interface FormValues {
  source: string;
  presetFolder: string;
  /** Comma-separated BambuStudio printer names; one preset is written per printer. */
  printerPreset: string;
  /** Replace BambuStudio presets that already exist. */
  overwritePresets: boolean;
  host: string;
  port: string;
  securityKey: string;
  https: boolean;
  skipSpoolease: boolean;
  createSpools: boolean;
  /** Initial SpoolmanDB search. */
  query: string;
  /** SpoolmanDB filament diameter in mm. */
  diameter: number;
}
