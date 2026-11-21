// ABOUTME: Resolves the SpoolEase console every command and the TUI use: flags, environment, keyring, tui.json, then
// ABOUTME: what the SpoolEase build of BambuStudio keeps in <BambuStudio config>/spoolease/config.json.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { bambuConfigDir } from "./paths.js";
import { KeyringError, loadSecret, SECRETS, secretProblem } from "./secrets.js";
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

/** The key in the keyring; null when none is stored or the keyring can't be reached. */
async function keyringKey(): Promise<string | null> {
  try {
    return (await loadSecret(SECRETS.spoolease, {}))?.value ?? null;
  } catch (err) {
    // A keyring that can't be reached only means there's no saved key here.
    if (err instanceof KeyringError) return null;
    throw err;
  }
}

/**
 * The key from SPOOLEASE_SECURITY_KEY; null when it isn't set. Never reads the keyring. `lenient` takes an unusable
 * one for no key instead of throwing InvalidSecretError.
 */
async function envKey(
  env: Record<string, string | undefined>,
  lenient: boolean,
): Promise<string | null> {
  const value = env[SECRETS.spoolease.env];
  if (!value?.trim()) return null;
  if (lenient && secretProblem(SECRETS.spoolease, value) !== null) return null;
  return (await loadSecret(SECRETS.spoolease, env))?.value ?? null;
}

export interface ConsoleSettingsOptions {
  /**
   * false: never reads the keyring (which may ask to be unlocked) and takes an unusable SPOOLEASE_SECURITY_KEY for
   * no key, for a session that skips SpoolEase. Default true.
   */
  keyring?: boolean;
}

/** Where the console's host came from: everything else about the console follows it. */
type HostSource = "argument" | "tui" | "bambu" | "none";

/**
 * The console every command and the TUI use. Each value belongs to the console the host names, so no two come
 * from different consoles:
 * - Host: --spoolease-host, SPOOLEASE_HOST, the TUI's saved console (tui.json), BambuStudio's.
 * - Port and HTTPS: the flags, else tui.json's only when the host came from tui.json, else 80 and off
 *   (BambuStudio's address port is its HTTPS port, never ours).
 * - Key: --spoolease-security-key, SPOOLEASE_SECURITY_KEY, else the host's own: BambuStudio's key for
 *   BambuStudio's host (then the keyring, when BambuStudio has none), the keyring for every other host.
 * The keyring is only read when nothing before it gives the key, and never with `keyring: false`. An unusable key
 * from the variable or the keyring throws InvalidSecretError, which says where it came from and never what it is.
 */
export async function consoleSettings(
  flags: SpoolEaseFlags,
  env: Record<string, string | undefined> = process.env,
  options: ConsoleSettingsOptions = {},
): Promise<ConsoleSettings> {
  const useKeyring = options.keyring ?? true;
  const [bambu, remembered] = await Promise.all([readSpoolEaseConfig(), loadTuiSettings()]);
  const saved = remembered.console ?? {};
  const given = flags["spoolease-host"] || env.SPOOLEASE_HOST;
  const [host, source]: [string, HostSource] = given
    ? [given, "argument"]
    : saved.host
      ? [saved.host, "tui"]
      : bambu.host
        ? [bambu.host, "bambu"]
        : ["", "none"];
  const stored = async () => (useKeyring ? await keyringKey() : null);
  const ownKey = async () =>
    source === "bambu" ? bambu.securityKey || (await stored()) : await stored();
  const securityKey =
    flags["spoolease-security-key"] || (await envKey(env, !useKeyring)) || (await ownKey()) || "";
  const fromTui = source === "tui";
  return {
    host,
    port: flags["spoolease-port"] ?? String((fromTui ? saved.port : undefined) ?? 80),
    securityKey,
    https: flags["spoolease-https"] ?? (fromTui ? saved.https : undefined) ?? false,
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
