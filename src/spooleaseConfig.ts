// ABOUTME: Reads the SpoolEase console address and security key that the SpoolEase build of BambuStudio
// ABOUTME: keeps in <BambuStudio config>/spoolease/config.json, so they needn't be typed on every run.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { bambuConfigDir } from "./paths.js";

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
export async function readSpoolEaseConfig(configDir: string = bambuConfigDir()): Promise<SpoolEaseSettings> {
  try {
    const config = JSON.parse(await readFile(join(configDir, "spoolease", "config.json"), "utf-8"));
    const address = text(config?.console?.address);
    return { host: address ? text(hostOf(address)) : null, securityKey: text(config?.console?.security_key) };
  } catch {
    return { host: null, securityKey: null };
  }
}
