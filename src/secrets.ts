// ABOUTME: API keys kept in the system keyring (macOS Keychain, Linux Secret Service), never in a file we write.
// ABOUTME: An environment variable per key overrides the keyring, for machines without one.

import { AsyncEntry } from "@napi-rs/keyring";

import { errorMessage } from "./errors.js";

/** One API key bambu-hando can keep: its `key` command name, keyring account and overriding variable. */
export interface SecretSpec {
  name: string;
  label: string;
  account: string;
  env: string;
  /** What every key of this service starts with, to catch a wrong paste; empty when its keys have no common start. */
  prefix: string;
  /** Spaces may be part of a key: a console's key is whatever its owner typed. */
  spaces?: boolean;
}

export const SECRETS = {
  "3dfp": {
    name: "3dfp",
    label: "3DFilamentProfiles API key",
    account: "3dfilamentprofiles-api-key",
    env: "FILAMENTPROFILES_API_KEY",
    prefix: "3dfp_",
  },
  spoolease: {
    name: "spoolease",
    label: "SpoolEase security key",
    account: "spoolease-security-key",
    env: "SPOOLEASE_SECURITY_KEY",
    // Set by whoever set up the console: any text at all.
    prefix: "",
    spaces: true,
  },
} as const satisfies Record<string, SecretSpec>;

const SERVICE = "bambu-hando";

export class KeyringError extends Error {}

/** A key from the environment or the keyring that `validateSecret` refuses; says where it came from, never its value. */
export class InvalidSecretError extends Error {}

/** What to say when a key turns up among the arguments; never repeats it. */
export const KEY_ARGUMENT_ERROR =
  "keys are never taken as arguments, so that one is now in your shell history (consider revoking it); run `bambu-hando key set <name>` and paste the key at the prompt";

/**
 * True when an argument holds what looks like one of the keys: its prefix anywhere, as in `--key=3dfp_...`.
 * Keys without a prefix can't be spotted this way (every argument would contain the empty one).
 */
export function holdsSecret(arg: string): boolean {
  return Object.values(SECRETS).some(
    (spec: SecretSpec) => spec.prefix !== "" && arg.includes(spec.prefix),
  );
}

export function secretByName(name: string): SecretSpec | undefined {
  return Object.hasOwn(SECRETS, name) ? SECRETS[name as keyof typeof SECRETS] : undefined;
}

export function keyringName(platform: string = process.platform): string {
  return platform === "darwin" ? "the macOS Keychain" : "the system keyring (Secret Service)";
}

/** The key without the whitespace a paste or pipe adds; never quotes the value in its errors. */
export function validateSecret(value: string, spec?: SecretSpec): string {
  const key = value.trim();
  if (key === "") throw new Error("the key is empty");
  // Control characters inside mean a mangled paste (or two lines), not a key; so do spaces, for keys without any.
  if (spec?.spaces) {
    if (/\p{Cc}/u.test(key))
      throw new Error("the key contains control characters: paste only the key");
  } else if (/[\s\p{Cc}]/u.test(key))
    throw new Error("the key contains spaces or control characters: paste only the key");
  if (spec?.prefix && !key.startsWith(spec.prefix))
    throw new Error(`${spec.label}s start with ${spec.prefix}: that doesn't look like one`);
  return key;
}

function entry(spec: SecretSpec): AsyncEntry {
  // Pinned to the Secret Service on Linux: the fallback, the kernel keyring, loses keys on reboot.
  return new AsyncEntry(SERVICE, spec.account, { linux: { store: "secret-service" } });
}

async function inKeyring<T>(spec: SecretSpec, use: (entry: AsyncEntry) => Promise<T>): Promise<T> {
  try {
    return await use(entry(spec));
  } catch (err) {
    throw new KeyringError(
      `can't use ${keyringName()} (${errorMessage(err)}): unlock it, or set ${spec.env} instead`,
    );
  }
}

export async function storeSecret(spec: SecretSpec, value: string): Promise<void> {
  await inKeyring(spec, (e) => e.setPassword(value));
}

/** The key in the keyring, ignoring the environment; null when none is stored. */
export async function storedSecret(spec: SecretSpec): Promise<string | null> {
  return inKeyring(spec, (e) => e.getPassword());
}

/** True when a key was stored and is now gone; false when there was none. */
export async function removeSecret(spec: SecretSpec): Promise<boolean> {
  return inKeyring(spec, (e) => e.deletePassword());
}

export interface LoadedSecret {
  value: string;
  from: "env" | "keyring";
}

/** Why a key (from the keyring or the environment) isn't usable, or null when it is; never quotes it. */
export function secretProblem(spec: SecretSpec, value: string): string | null {
  try {
    validateSecret(value, spec);
    return null;
  } catch (err) {
    return errorMessage(err);
  }
}

/** The key to use: the environment variable when set, else the keyring's; null when neither has one. */
export async function loadSecret(
  spec: SecretSpec,
  env: Record<string, string | undefined> = process.env,
): Promise<LoadedSecret | null> {
  // Checked like `key set` checks a paste: a mangled value would end up in a header, and in fetch's error about it.
  const fromEnv = env[spec.env]?.trim();
  if (fromEnv) {
    try {
      return { value: validateSecret(fromEnv, spec), from: "env" };
    } catch (err) {
      throw new InvalidSecretError(
        `${spec.env} doesn't hold a usable ${spec.label}: ${errorMessage(err)}`,
      );
    }
  }
  const stored = await storedSecret(spec);
  if (stored === null) return null;
  const problem = secretProblem(spec, stored);
  if (problem)
    throw new InvalidSecretError(
      `the ${spec.label} stored in ${keyringName()} isn't usable: ${problem}; store it again with \`bambu-hando key set ${spec.name}\``,
    );
  return { value: stored.trim(), from: "keyring" };
}
