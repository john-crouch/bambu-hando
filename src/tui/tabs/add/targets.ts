// ABOUTME: Where an Add run writes, from the session's settings: preset folder, printers and the SpoolEase console.
// ABOUTME: The console is named by its URL only; the security key never leaves the connection object.

import { isIP } from "node:net";

import { bambuBaseFilamentDir, tildePath } from "../../../paths.js";
import type { SpoolEaseConnection } from "../../../spoolease.js";
import type { FormValues } from "../../core/values.js";

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

/** The console's web UI, with the port only when it's a valid port other than the scheme's default. */
export function consoleUrl({
  host,
  port,
  https,
}: Pick<SpoolEaseConnection, "host" | "port" | "https">): string {
  const scheme = https ? "https" : "http";
  const bare = host.replace(/^\[|\]$/g, "");
  // An IPv6 address goes in brackets, its zone ID's "%" written "%25" (RFC 6874).
  const name = isIP(bare.split("%")[0] ?? "") === 6 ? `[${bare.replace(/%(?!25)/, "%25")}]` : host;
  const shown = Number.isInteger(port) && port > 0 && port <= 65535 && port !== (https ? 443 : 80);
  return shown ? `${scheme}://${name}:${port}` : `${scheme}://${name}`;
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
