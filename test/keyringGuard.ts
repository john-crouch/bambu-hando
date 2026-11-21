// ABOUTME: Keeps tests away from the login keyring on every OS (it holds real keys): in-process keyring calls pass
// ABOUTME: only on a private keyring's bus (setupKeyringGuard.ts), and spawned commands must get each key they'd look up.

import { existsSync } from "node:fs";

export const LOGIN_KEYRING_OFF_LIMITS =
  "tests never use the login keyring: start a private one with test/keyring.ts";

/** D-Bus addresses of the private keyrings test/keyring.ts started in this process. */
const privateBuses = new Set<string>();

export function registerPrivateBus(address: string): void {
  privateBuses.add(address);
}

/** True when keyring calls here reach a private keyring: Linux only (macOS has one Keychain per user). */
export function privateBusInUse(env: Record<string, string | undefined> = process.env): boolean {
  return process.platform === "linux" && privateBuses.has(env.DBUS_SESSION_BUS_ADDRESS ?? "");
}

/** A bus that can't be the login keyring's: a private one, or a socket path with nothing there. Linux only. */
function testBus(env: Record<string, string | undefined>): boolean {
  if (process.platform !== "linux") return false;
  const address = env.DBUS_SESSION_BUS_ADDRESS ?? "";
  if (privateBusInUse(env)) return true;
  const path = /^unix:path=([^,;]+)$/.exec(address)?.[1];
  return path !== undefined && !existsSync(path);
}

/**
 * Throws unless a bambu-hando run with these arguments and this environment can't consult the login
 * keyring: each key it would look up must come from its variable (or the console's from its flag), or it
 * must run on a bus that can't be the login one. `key` commands use the keyring by design, so only the latter.
 */
export function assertNoLoginKeyring(
  args: readonly string[],
  env: Record<string, string | undefined>,
): void {
  const has = (flag: string) => args.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
  if (has("--help") || args.includes("-h") || testBus(env)) return;
  const [command, sub] = args;
  if (command === "key")
    throw new Error(`bambu-hando key needs a test bus: ${LOGIN_KEYRING_OFF_LIMITS}`);
  const headless = command?.startsWith("-") ?? false;
  const console =
    command === "tui" ||
    command === "labels" ||
    command === "check" ||
    (command === "3dfp" && sub === "sync") ||
    (headless && !has("--skip-spoolease"));
  if (console && !env.SPOOLEASE_SECURITY_KEY?.trim() && !has("--spoolease-security-key"))
    throw new Error(
      `give bambu-hando ${args.join(" ")} SPOOLEASE_SECURITY_KEY or --spoolease-security-key: ${LOGIN_KEYRING_OFF_LIMITS}`,
    );
  if (command === "3dfp" && !env.FILAMENTPROFILES_API_KEY?.trim())
    throw new Error(
      `give bambu-hando ${args.join(" ")} FILAMENTPROFILES_API_KEY: ${LOGIN_KEYRING_OFF_LIMITS}`,
    );
}
