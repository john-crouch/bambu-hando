// ABOUTME: The SpoolEase console the session's settings point at: whether one is set up, and its connection.
// ABOUTME: Shared by the Settings and Check tabs, with the printer list helpers both read.

import type { SpoolEaseConnection } from "../../../spoolease.js";
import type { FormValues } from "../../core/values.js";
import { shortPrinter } from "../../ui/index.js";

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

/** A BambuStudio printer as people read it, short: "X1C 0.4". */
export function printerLabel(printer: string): string {
  return shortPrinter(printer);
}

/** A printer's model and nozzle: "X1C 0.4" → ["X1C", 0.4]; no nozzle → NaN. */
function modelAndNozzle(printer: string): [string, number] {
  const short = shortPrinter(printer);
  const match = /^(.*) (\d+(?:\.\d+)?)$/.exec(short);
  return match ? [match[1] ?? short, Number(match[2])] : [short, Number.NaN];
}

/** Printers in order of model, then nozzle: "A1 0.4", "A1 mini 0.2", "X1C 0.4", "X1C 0.6". */
export function byModelAndNozzle(a: string, b: string): number {
  const [modelA, nozzleA] = modelAndNozzle(a);
  const [modelB, nozzleB] = modelAndNozzle(b);
  return (
    modelA.localeCompare(modelB, undefined, { sensitivity: "base", numeric: true }) ||
    (nozzleA || 0) - (nozzleB || 0)
  );
}

/** Printers as people read them, nozzles of one model together: "X1C 0.4, 0.6, P1S 0.4". */
export function shortPrinters(printers: readonly string[]): string {
  const models = new Map<string, number[]>();
  for (const printer of printers) {
    const [model, nozzle] = modelAndNozzle(printer);
    models.set(model, [...(models.get(model) ?? []), ...(Number.isNaN(nozzle) ? [] : [nozzle])]);
  }
  return [...models]
    .map(([model, nozzles]) => [model, nozzles.map(String).join(", ")].filter(Boolean).join(" "))
    .join(", ");
}
