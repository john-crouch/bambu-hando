// ABOUTME: Reads the SpoolEase console address and security key that the SpoolEase build of BambuStudio
// ABOUTME: keeps in <BambuStudio config>/spoolease/config.json, so they needn't be typed on every run.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { bambuConfigDir } from "./paths.js";
import type { SpoolEaseConnection } from "./spoolease.js";

export interface SpoolEaseSettings {
  host: string | null;
  securityKey: string | null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// Like BambuStudio's normalized_address: no scheme, no path. The port is dropped too, because
// BambuStudio's is its HTTPS port and ours comes from --spoolease-port.
function hostOf(address: string): string {
  const host = address.replace(/^https?:\/\//, "").split("/")[0] ?? "";
  return host.replace(/:\d+$/, "");
}

/** The console host and security key from BambuStudio's SpoolEase settings; nulls when unknown. */
export async function readSpoolEaseConfig(
  configDir: string = bambuConfigDir(),
): Promise<SpoolEaseSettings> {
  try {
    const config = JSON.parse(await readFile(join(configDir, "spoolease", "config.json"), "utf-8"));
    const address = text(config?.console?.address);
    return {
      host: address ? text(hostOf(address)) : null,
      securityKey: text(config?.console?.security_key),
    };
  } catch {
    return { host: null, securityKey: null };
  }
}

/** How to give bambu-hando the console's address and key, for "required" errors. */
export const SPOOLEASE_SETTINGS_HINT =
  "pass --spoolease-host and --spoolease-security-key, set SPOOLEASE_HOST and SPOOLEASE_SECURITY_KEY, or configure SpoolEase in BambuStudio";

/** The SpoolEase connection flags shared by every command that talks to the console. */
export interface SpoolEaseFlags {
  "spoolease-host"?: string;
  "spoolease-security-key"?: string;
  "spoolease-https": boolean;
}

/** Flags, then environment, then the SpoolEase settings saved in BambuStudio; null without both a host and a key. */
export function spooleaseConnectionFrom(
  flags: SpoolEaseFlags,
  port: number,
  saved: SpoolEaseSettings,
  env: Record<string, string | undefined> = process.env,
): SpoolEaseConnection | null {
  const host = flags["spoolease-host"] || env.SPOOLEASE_HOST || saved.host || "";
  const securityKey =
    flags["spoolease-security-key"] || env.SPOOLEASE_SECURITY_KEY || saved.securityKey || "";
  return host && securityKey ? { host, securityKey, port, https: flags["spoolease-https"] } : null;
}
