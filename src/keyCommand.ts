// ABOUTME: `bambu-hando key set|status|remove`: keeps API keys in the system keyring, read from a hidden prompt or a pipe.
// ABOUTME: Keys are never taken as arguments and never printed; exit 2 on usage errors, 1 when the keyring fails.

import { errorMessage } from "./errors.js";
import { promptHidden, PromptCancelled, readPiped, type SecretInput } from "./secretPrompt.js";
import { holdsSecret, KEY_ARGUMENT_ERROR, KeyringError, keyringName, removeSecret, SECRETS, type SecretSpec, secretByName, secretProblem, storedSecret, storeSecret, validateSecret } from "./secrets.js";

export interface KeyIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  stdin: SecretInput;
}

const KNOWN = Object.values(SECRETS);

export const KEY_USAGE = `Usage: bambu-hando key <set|status|remove> [name]

Keeps API keys in the system keyring (the macOS Keychain, or the Secret Service on Linux), never in a file.

  set <name>      Read a key from a hidden prompt (or from stdin when piped) and store it
  status [name]   Say where each key comes from, never its value
  remove <name>   Delete a stored key

Keys:
${KNOWN.map((spec) => `  ${spec.name.padEnd(14)}  ${spec.label}; ${spec.env} overrides the stored one`).join("\n")}

Keys are never taken as arguments: they would end up in your shell history and in ps.
`;

class KeyUsageError extends Error {}

function knownNames(): string {
  return KNOWN.map((spec) => spec.name).join(", ");
}

function spec(name: string | undefined, action: string): SecretSpec {
  if (name === undefined) throw new KeyUsageError(`say which key to ${action} (known: ${knownNames()})`);
  const found = secretByName(name);
  // Not quoted: a key pasted where its name goes would be printed back.
  if (!found) throw new KeyUsageError(`unknown key (known: ${knownNames()})`);
  return found;
}

function hasRawMode(stdin: SecretInput): stdin is SecretInput & { setRawMode: (mode: boolean) => unknown } {
  return typeof stdin.setRawMode === "function";
}

async function readKey(target: SecretSpec, io: KeyIo): Promise<string> {
  const { stdin } = io;
  if (stdin.isTTY && hasRawMode(stdin)) return promptHidden(stdin, io.stderr, `${target.label} (input hidden): `);
  const piped = await readPiped(stdin);
  // Nothing at all, rather than a blank line, means stdin was closed: run where there's no terminal.
  if (piped === "") throw new Error("no key was piped in, and stdin isn't a terminal to prompt on: run this in a terminal, or pipe the key in");
  return piped;
}

async function setKey(target: SecretSpec, io: KeyIo, env: Record<string, string | undefined>): Promise<number> {
  let key: string;
  try {
    key = validateSecret(await readKey(target, io), target);
  } catch (err) {
    if (err instanceof PromptCancelled) {
      io.stderr("Cancelled: nothing was stored.\n");
      return 130;
    }
    throw new KeyUsageError(errorMessage(err));
  }
  const replaced = (await storedSecret(target)) !== null;
  await storeSecret(target, key);
  io.stdout(`${replaced ? "Replaced" : "Stored"} the ${target.label} in ${keyringName()}.\n`);
  if (env[target.env]?.trim()) io.stderr(`Note: ${target.env} is set and overrides the stored key until you unset it.\n`);
  return 0;
}

async function statusLine(target: SecretSpec, env: Record<string, string | undefined>): Promise<string> {
  const head = `${target.name}  ${target.label}`;
  const fromEnv = env[target.env]?.trim();
  if (fromEnv) {
    // Checked as every command checks it, so status never says a key is in use that they'd refuse.
    const problem = secretProblem(target, fromEnv);
    const source = problem ? `from ${target.env}, but not usable (${problem})` : `from ${target.env}`;
    let stored: string | null;
    try {
      stored = await storedSecret(target);
    } catch (err) {
      if (!(err instanceof KeyringError)) throw err;
      return `${head}: ${source} (can't check ${keyringName()})`;
    }
    return stored === null ? `${head}: ${source}` : `${head}: ${source} (overrides the one stored in ${keyringName()})`;
  }
  const stored = await storedSecret(target);
  if (stored === null) return `${head}: not set (bambu-hando key set ${target.name})`;
  const problem = secretProblem(target, stored);
  return problem ? `${head}: stored in ${keyringName()}, but not usable (${problem})` : `${head}: stored in ${keyringName()}`;
}

async function removeKey(target: SecretSpec, io: KeyIo): Promise<number> {
  const removed = await removeSecret(target);
  io.stdout(removed ? `Removed the ${target.label} from ${keyringName()}.\n` : `No ${target.label} was stored.\n`);
  return 0;
}

export async function keyCommand(argv: string[], io: KeyIo, env: Record<string, string | undefined> = process.env): Promise<number> {
  if (argv.length === 0 || argv.some((arg) => arg === "-h" || arg === "--help")) {
    io.stdout(KEY_USAGE);
    return 0;
  }
  const [action, name, ...rest] = argv;
  try {
    // Anything past the name, or anything shaped like a key, is most likely the key itself: never repeat it back.
    if (rest.length > 0 || name?.startsWith("-") || argv.some(holdsSecret)) throw new KeyUsageError(KEY_ARGUMENT_ERROR);
    if (action === "set") return await setKey(spec(name, "set"), io, env);
    if (action === "remove") return await removeKey(spec(name, "remove"), io);
    if (action === "status") {
      const targets = name === undefined ? KNOWN : [spec(name, "check")];
      const lines = [];
      for (const target of targets) lines.push(await statusLine(target, env));
      io.stdout(`${lines.join("\n")}\n`);
      return 0;
    }
    throw new KeyUsageError("unknown action (set, status or remove)");
  } catch (err) {
    if (err instanceof KeyUsageError) {
      io.stderr(`bambu-hando: error: ${err.message}\n\n${KEY_USAGE}`);
      return 2;
    }
    io.stderr(`bambu-hando: error: ${errorMessage(err)}\n`);
    return 1;
  }
}
