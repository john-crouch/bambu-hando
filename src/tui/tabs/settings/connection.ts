// ABOUTME: The SpoolEase console the session's settings point at: whether one is set up, its connection and its URL.
// ABOUTME: Shared by the Settings and Check tabs; the URL never carries the security key.

import { isIP } from "node:net";

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

/** The console's web address, the default port left out. */
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
