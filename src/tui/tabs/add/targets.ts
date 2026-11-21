// ABOUTME: Where an Add run writes, from the session's settings: preset folder, printers and the SpoolEase console.
// ABOUTME: The console is named by its URL only; the security key never leaves the connection object.

import { bambuBaseFilamentDir, tildePath } from "../../../paths.js";
import type { SpoolEaseConnection } from "../../../spoolease.js";
import type { FormValues } from "../../core/values.js";
import { consoleUrl } from "../../ui/ConsoleLink.js";

export { consoleUrl };

export function printersOf(values: FormValues): string[] {
  return values.printerPreset
    .split(",")
    .map((printer) => printer.trim())
    .filter(Boolean);
}

/** skipped: the run leaves SpoolEase alone; missing: it isn't skipped but has no host or key yet. */
export type ConsoleSetup = "ready" | "skipped" | "missing";

export function consoleSetup(values: FormValues): ConsoleSetup {
  if (values.skipSpoolease) return "skipped";
  return values.host.trim() && values.securityKey ? "ready" : "missing";
}

/** The console to talk to; null when SpoolEase is skipped or not set up. */
export function consoleOf(values: FormValues): SpoolEaseConnection | null {
  if (consoleSetup(values) !== "ready") return null;
  return {
    host: values.host.trim(),
    port: Number(values.port),
    securityKey: values.securityKey,
    https: values.https,
  };
}

/** Whether a run creates spools: only with a console to create them on. */
export function createsSpools(values: FormValues): boolean {
  return values.createSpools && consoleSetup(values) === "ready";
}

/** Why a run can't start with these settings, or "" when it can. */
export function runError(values: FormValues): string {
  if (!values.presetFolder.trim()) return "Choose a BambuStudio preset folder in Settings";
  if (printersOf(values).length === 0) return "Choose at least one printer in Settings";
  const setup = consoleSetup(values);
  if (setup === "missing")
    return "SpoolEase needs a host and security key in Settings, or Skip SpoolEase on";
  if (setup === "ready") {
    const port = Number(values.port);
    if (!Number.isInteger(port) || port < 1 || port > 65_535)
      return "SpoolEase port must be a number between 1 and 65535 (Settings)";
  }
  return "";
}

/** The Settings row that fixes runError's problem (a deep link for app/switchTab), or null when there's none. */
export function runErrorFocus(values: FormValues): string | null {
  if (!values.presetFolder.trim()) return "bambu.folder";
  if (printersOf(values).length === 0) return "bambu.printers";
  const setup = consoleSetup(values);
  if (setup === "missing") return values.host.trim() ? "spoolease.key" : "spoolease.host";
  if (setup === "ready" && runError(values)) return "spoolease.port";
  return null;
}

/** The Settings row for a SpoolEase or BambuStudio error a check or run reported. */
export function errorFocus(error: string): string {
  if (/SpoolEase unreachable/i.test(error)) return "spoolease.host";
  if (/SpoolEase key/i.test(error)) return "spoolease.key";
  if (/printer/i.test(error)) return "bambu.printers";
  return /SpoolEase/i.test(error) ? "spoolease" : "bambu";
}

/** The settings a plan is read with: when any of them changes, the plan no longer says what a run does. */
const BASIS_KEYS = [
  "presetFolder",
  "printerPreset",
  "overwritePresets",
  "createSpools",
  "skipSpoolease",
  "host",
  "port",
  "https",
  "securityKey",
] as const satisfies readonly (keyof FormValues)[];

export type PlanBasis = Pick<FormValues, (typeof BASIS_KEYS)[number]>;

export function planBasis(values: FormValues): PlanBasis {
  return Object.fromEntries(BASIS_KEYS.map((key) => [key, values[key]])) as PlanBasis;
}

export function sameBasis(a: PlanBasis, b: PlanBasis): boolean {
  return BASIS_KEYS.every((key) => a[key] === b[key]);
}

export interface RunTargets {
  /** The folder presets go into, with ~ for the home folder. */
  presetDir: string;
  printers: string[];
  overwrite: boolean;
  console: ConsoleSetup;
  /** The console's URL when it's set up. */
  consoleUrl: string;
  createSpools: boolean;
}

/** Every target a run writes to, for the review page's card. */
export function runTargets(values: FormValues): RunTargets {
  const connection = consoleOf(values);
  return {
    presetDir: tildePath(bambuBaseFilamentDir(values.presetFolder.trim())),
    printers: printersOf(values),
    overwrite: values.overwritePresets,
    console: consoleSetup(values),
    consoleUrl: connection ? consoleUrl(connection) : "",
    createSpools: createsSpools(values),
  };
}
