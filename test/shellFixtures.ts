// ABOUTME: Shared fixtures for the shell's tests: session settings with a console set up.
// ABOUTME: Each test overrides only the fields it is about.

import type { FormValues } from "../src/tui/core/values.js";

export function values(overrides: Partial<FormValues> = {}): FormValues {
  return {
    source: "",
    presetFolder: "default",
    printerPreset: "Bambu Lab X1 Carbon 0.4 nozzle",
    overwritePresets: false,
    host: "10.0.0.5",
    port: "80",
    securityKey: "SECRET",
    https: false,
    skipSpoolease: false,
    createSpools: true,
    query: "",
    diameter: 1.75,
    ...overrides,
  };
}
