// ABOUTME: Loads reference outputs captured from the original Python implementation.
// ABOUTME: Unit tests compare the TypeScript port against these byte for byte.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { FilamentProfile } from "../src/models.js";

interface PythonProfile {
  name: string;
  brand: string;
  material: string;
  color_name: string;
  color_rgba: string;
  nozzle_temp_min: number;
  nozzle_temp_max: number;
  density: number;
  diameter: number;
  slicer_filament_code: string;
}

interface ParityFixture {
  printer_preset: string;
  profiles: PythonProfile[];
  presets: string[];
  custom_filaments_csv: string;
  spool_payloads: Record<string, unknown>[];
  encryption: {
    security_key: string;
    derived_key_hex: string;
    nonce_hex: string;
    plaintext: string;
    encrypted_fixed_nonce: string;
    encrypted_random_nonce: string;
  };
}

export const SOURCE_FIXTURE = fileURLToPath(new URL("./fixtures/source.json", import.meta.url));

export const parity: ParityFixture = JSON.parse(
  readFileSync(new URL("./fixtures/python-parity.json", import.meta.url), "utf-8"),
);

export const parityProfiles: FilamentProfile[] = parity.profiles.map((p) => ({
  name: p.name,
  brand: p.brand,
  material: p.material,
  colorName: p.color_name,
  colorRgba: p.color_rgba,
  nozzleTempMin: p.nozzle_temp_min,
  nozzleTempMax: p.nozzle_temp_max,
  density: p.density,
  diameter: p.diameter,
  slicerFilamentCode: p.slicer_filament_code,
}));

export function profileAt(index: number): FilamentProfile {
  const profile = parityProfiles[index];
  if (!profile) throw new Error(`No parity profile at index ${index}`);
  return profile;
}
