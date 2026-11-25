#!/usr/bin/env node
// ABOUTME: Dev tool: drives the built TUI (dist/) in a real pseudo-terminal and prints screens as a terminal shows them.
// ABOUTME: Steps wait for text, press keys or type, and snapshot the screen; run `npm run tui:snap -- --help`.

import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

import xterm from "@xterm/headless";
import { spawn } from "node-pty";

const BIN = fileURLToPath(new URL("../dist/bin.js", import.meta.url));

const USAGE = `Usage: npm run tui:snap -- [options] <step>... [-- <bambu-hando tui args>]

Runs bambu-hando tui in a real pseudo-terminal with your HOME (so your own BambuStudio
and SpoolEase settings), plays the steps in order, then quits with ctrl+c.

Steps:
  wait=<text>      wait until <text> appears after the previous wait's match
  key=<name>       press a key: ${"enter tab shift+tab esc up down left right pgup pgdn home end space backspace ctrl+a ctrl+c ctrl+k"}
  type=<text>      type <text> one character at a time
  snap[=<title>]   print the screen
  sleep=<ms>       pause

Options:
  --cols <n>       terminal width (default 110)
  --rows <n>       terminal height (default 45)
  --timeout <ms>   how long a wait may take (default 30000)
  -h, --help       show this help

Example:
  npm run tui:snap -- "wait=ctrl+c quit" key=enter wait=SpoolmanDB: "type=polylite petg" snap=picker -- --source spoolmandb

Exit codes: 0 every step ran, 1 a wait timed out, 2 invalid arguments.
`;

const KEYS = {
  enter: "\r",
  tab: "\t",
  esc: "\u001B",
  up: "\u001B[A",
  down: "\u001B[B",
  right: "\u001B[C",
  left: "\u001B[D",
  space: " ",
  backspace: "\u007F",
  "ctrl+a": "\u0001",
  "ctrl+c": "\u0003",
  "ctrl+k": "\u000B",
  "shift+tab": "\u001B[Z",
  pgup: "\u001B[5~",
  pgdn: "\u001B[6~",
  home: "\u001B[H",
  end: "\u001B[F",
};

// Ink switches to non-interactive rendering under CI-like variables, so the TUI gets only these.
const PASSED_ENV = [
  "PATH",
  "HOME",
  "LANG",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "SPOOLMANDB_URL",
  "SPOOLEASE_HOST",
  "SPOOLEASE_SECURITY_KEY",
  "FILAMENTPROFILES_API_URL",
  "FILAMENTPROFILES_API_KEY",
];

// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC and BEL delimit the escape sequences this strips.
const ANSI = /\u001B\[[0-9;?]*[ -/]*[@-~]|\u001B\][^\u0007]*\u0007/g;

function usageError(message) {
  process.stderr.write(`tui-snap: error: ${message}\n\n${USAGE}`);
  process.exit(2);
}

function parseArgs(argv) {
  const options = { cols: 110, rows: 45, timeout: 30_000 };
  const steps = [];
  let tuiArgs = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      tuiArgs = argv.slice(i + 1);
      break;
    }
    if (arg === "-h" || arg === "--help") {
      process.stdout.write(USAGE);
      process.exit(0);
    }
    if (arg === "--cols" || arg === "--rows" || arg === "--timeout") {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value < 1) usageError(`${arg} needs a positive whole number`);
      options[arg.slice(2)] = value;
      continue;
    }
    const [name, ...rest] = arg.split("=");
    const value = rest.join("=");
    if (name === "key" && !(value in KEYS)) usageError(`unknown key "${value}"`);
    if (name === "sleep" && !(Number(value) >= 0))
      usageError(`sleep needs milliseconds, got "${value}"`);
    if (
      !["wait", "key", "type", "snap", "sleep"].includes(name) ||
      (name !== "snap" && rest.length === 0)
    )
      usageError(`unknown step "${arg}"`);
    steps.push({ name, value });
  }
  return { options, steps, tuiArgs };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Ink draws before raw mode is on; a key sent before then is lost in the cooked line discipline. */
function rawModeOn(ptsName) {
  const flag = process.platform === "darwin" ? "-f" : "-F";
  return new Promise((resolve) =>
    execFile("stty", [flag, ptsName, "-a"], (err, stdout) =>
      resolve(!err && /(^|\s)-icanon(\s|$)/.test(stdout)),
    ),
  );
}

async function main() {
  const { options, steps, tuiArgs } = parseArgs(process.argv.slice(2));
  const env = Object.fromEntries(
    PASSED_ENV.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]),
  );
  const term = new xterm.Terminal({
    cols: options.cols,
    rows: options.rows,
    allowProposedApi: true,
  });
  const pty = spawn(process.execPath, [BIN, "tui", ...tuiArgs], {
    name: "xterm-256color",
    cols: options.cols,
    rows: options.rows,
    env: { ...env, TERM: "xterm-256color" },
  });

  let raw = "";
  let lastData = Date.now();
  let exitCode = null;
  pty.onData((data) => {
    raw += data;
    lastData = Date.now();
    term.write(data);
  });
  pty.onExit(({ exitCode: code }) => {
    exitCode = code;
  });

  // Let the emulator catch up, then wait for output to go quiet so the screen is settled.
  async function settled() {
    await new Promise((resolve) => term.write("", resolve));
    const deadline = Date.now() + 3_000;
    while (Date.now() - lastData < 250 && Date.now() < deadline) await sleep(25);
    await new Promise((resolve) => term.write("", resolve));
  }

  function screen() {
    const buffer = term.buffer.active;
    const lines = [];
    for (let row = 0; row < options.rows; row++)
      lines.push(buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? "");
    while (lines.length > 0 && !lines.at(-1).trim()) lines.pop();
    return lines.join("\n");
  }

  let cursor = 0;
  let rawMode = false;
  for (const step of steps) {
    if (step.name === "wait") {
      const deadline = Date.now() + options.timeout;
      const find = () => raw.replace(ANSI, "").indexOf(step.value, cursor);
      let index = find();
      while (index === -1 && Date.now() < deadline && exitCode === null) {
        await sleep(25);
        index = find();
      }
      if (index === -1) {
        await settled();
        process.stdout.write(
          `!! timed out waiting for ${JSON.stringify(step.value)}\n--- screen ---\n${screen()}\n`,
        );
        if (exitCode === null) pty.kill();
        process.exit(1);
      }
      cursor = index + step.value.length;
      while (!rawMode && Date.now() < deadline) {
        rawMode = await rawModeOn(pty.ptsName);
        if (!rawMode) await sleep(25);
      }
    } else if (step.name === "key") {
      pty.write(KEYS[step.value]);
      await sleep(60);
    } else if (step.name === "type") {
      for (const char of step.value) {
        pty.write(char);
        await sleep(30);
      }
    } else if (step.name === "sleep") {
      await sleep(Number(step.value));
    } else {
      await settled();
      process.stdout.write(`--- ${step.value || "screen"} ---\n${screen()}\n\n`);
    }
  }

  if (exitCode === null) {
    await settled();
    pty.write(KEYS["ctrl+c"]);
    const deadline = Date.now() + 5_000;
    while (exitCode === null && Date.now() < deadline) await sleep(25);
    if (exitCode === null) pty.kill();
  }
  process.stdout.write(`exit: ${exitCode ?? "killed"}\n`);
}

await main();
