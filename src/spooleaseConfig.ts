// ABOUTME: Resolves the SpoolEase console every command and the TUI use: flags, environment, keyring, tui.json, then
// ABOUTME: what the SpoolEase build of BambuStudio keeps in <BambuStudio config>/spoolease/config.json.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { bambuConfigDir } from "./paths.js";
import { KeyringError, loadSecret, SECRETS } from "./secrets.js";
import type { SpoolEaseConnection } from "./spoolease.js";
import { loadTuiSettings } from "./tuiSettings.js";

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
  "pass --spoolease-host and --spoolease-security-key, set SPOOLEASE_HOST and SPOOLEASE_SECURITY_KEY, save them in the TUI's Settings (the key also with bambu-hando key set spoolease), or configure SpoolEase in BambuStudio";

/** The SpoolEase connection flags shared by every command that talks to the console. */
export interface SpoolEaseFlags {
  "spoolease-host"?: string;
  "spoolease-security-key"?: string;
  "spoolease-port"?: string;
  /** Left out when neither --spoolease-https nor --no-spoolease-https was given. */
  "spoolease-https"?: boolean;
}

/** The SpoolEase console as the flags, the environment and what was saved give it; empty when unknown. */
export interface ConsoleSettings {
  host: string;
  /** As typed or saved; each command checks it. */
  port: string;
  securityKey: string;
  https: boolean;
}

/** The key from SPOOLEASE_SECURITY_KEY or the keyring; null when neither has one or the keyring can't be reached. */
async function savedKey(env: Record<string, string | undefined>): Promise<string | null> {
  try {
    return (await loadSecret(SECRETS.spoolease, env))?.value ?? null;
  } catch (err) {
    // A keyring that can't be reached only means there's no saved key here; BambuStudio's may do.
    if (err instanceof KeyringError) return null;
    throw err;
  }
}

/**
 * The console every command and the TUI use. Host: flag, SPOOLEASE_HOST, the TUI's saved console,
 * BambuStudio's. Key: flag, SPOOLEASE_SECURITY_KEY, the keyring, BambuStudio's. Port and HTTPS: flag,
 * the TUI's saved console, then 80 and off. The keyring is only read when neither the flag nor the
 * variable gives the key. An unusable key from the variable or the keyring throws InvalidSecretError,
 * which says where it came from and never what it is.
 */
export async function consoleSettings(
  flags: SpoolEaseFlags,
  env: Record<string, string | undefined> = process.env,
): Promise<ConsoleSettings> {
  const [bambu, remembered] = await Promise.all([readSpoolEaseConfig(), loadTuiSettings()]);
  const saved = remembered.console ?? {};
  const host = flags["spoolease-host"] || env.SPOOLEASE_HOST || saved.host || bambu.host || "";
  const securityKey =
    flags["spoolease-security-key"] || (await savedKey(env)) || bambu.securityKey || "";
  return {
    host,
    port: flags["spoolease-port"] ?? String(saved.port ?? 80),
    securityKey,
    https: flags["spoolease-https"] ?? saved.https ?? false,
  };
}

/** The connection the settings make on a checked port; null without both a host and a key. */
export function spooleaseConnectionFrom(
  settings: ConsoleSettings,
  port: number,
): SpoolEaseConnection | null {
  const { host, securityKey, https } = settings;
  return host && securityKey ? { host, securityKey, port, https } : null;
}
