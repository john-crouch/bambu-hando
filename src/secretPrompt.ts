// ABOUTME: Reads a secret without echoing it: a hidden prompt on a terminal, or all of stdin when piped.
// ABOUTME: `secretKeys` is the pure keystroke handling, so the prompt is unit-tested without a terminal.

export interface SecretEntry {
  value: string;
  done: boolean;
  cancelled: boolean;
}

const CTRL_C = "\u0003";
const CTRL_D = "\u0004";
const CTRL_U = "\u0015";
const BACKSPACES = new Set(["\u007f", "\b"]);
// CSI sequences (arrows, bracketed-paste markers) and SS3 ones (some terminals' arrows).
const ESCAPES = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001bO.|\u001b/g;

/** The entry after a chunk of keystrokes; a paste arrives as one chunk. */
export function secretKeys(entry: SecretEntry, chunk: string): SecretEntry {
  let value = entry.value;
  for (const char of chunk.replace(ESCAPES, "")) {
    if (char === CTRL_C || (char === CTRL_D && value === "")) return { value: "", done: false, cancelled: true };
    if (char === "\r" || char === "\n" || char === CTRL_D) return { value, done: true, cancelled: false };
    if (BACKSPACES.has(char)) value = [...value].slice(0, -1).join("");
    else if (char === CTRL_U) value = "";
    else if (!/\p{Cc}/u.test(char)) value += char;
  }
  return { value, done: false, cancelled: false };
}

export class PromptCancelled extends Error {
  constructor() {
    super("Cancelled");
  }
}

/** What a terminal stdin offers on top of a readable stream. */
export interface SecretInput extends NodeJS.ReadableStream {
  isTTY?: boolean;
  setRawMode?: (mode: boolean) => unknown;
}

/** Everything piped to stdin, as text. */
export async function readPiped(input: NodeJS.ReadableStream): Promise<string> {
  let text = "";
  for await (const chunk of input) text += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8");
  return text;
}

/** Asks on `output` and reads keystrokes in raw mode, echoing nothing; rejects with PromptCancelled on ctrl+c. */
export function promptHidden(input: SecretInput & { setRawMode: (mode: boolean) => unknown }, output: (text: string) => void, prompt: string): Promise<string> {
  output(prompt);
  input.setRawMode(true);
  input.setEncoding("utf-8");
  input.resume();
  return new Promise((resolve, reject) => {
    let entry: SecretEntry = { value: "", done: false, cancelled: false };
    const onData = (chunk: string | Buffer): void => {
      entry = secretKeys(entry, String(chunk));
      if (!entry.done && !entry.cancelled) return;
      input.removeListener("data", onData);
      input.setRawMode(false);
      input.pause();
      output("\n");
      if (entry.cancelled) reject(new PromptCancelled());
      else resolve(entry.value);
    };
    input.on("data", onData);
  });
}
