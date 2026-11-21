// ABOUTME: The SpoolEase console the session's settings point at: whether one is set up, and its connection.
// ABOUTME: Shared by the Settings and Check tabs, with the printer list helpers both read.

import type { SpoolEaseConnection } from "../../../spoolease.js";
import type { FormValues } from "../../core/values.js";

/** The port as a number when it's a whole number from 1 to 65535, else null. */
export function validPort(port: string): number | null {
  const value = Number(port.trim());
  return port.trim() !== "" && Number.isInteger(value) && value >= 1 && value <= 65_535
    ? value
    : null;
}

/** The console to talk to: null when SpoolEase is skipped or the host, key or port is missing or invalid. */
export function connectionOf(values: FormValues): SpoolEaseConnection | null {
  if (values.skipSpoolease) return null;
  const host = values.host.trim();
  const port = validPort(values.port);
  if (!host || !values.securityKey || port === null) return null;
  return { host, port, securityKey: values.securityKey, https: values.https };
}

/** The printers presets are written for, from the comma-separated setting. */
export function printerList(printerPreset: string): string[] {
  return printerPreset
    .split(",")
    .map((printer) => printer.trim())
    .filter(Boolean);
}

/** A BambuStudio printer as people read it: without the vendor. */
export function printerLabel(printer: string): string {
  return printer.replace(/^Bambu Lab /, "");
}
