#!/usr/bin/env node
// ABOUTME: Executable entry point for the bambu-hando command.
// ABOUTME: Kept separate from cli.ts so tests can import main() without side effects.

import { main } from "./cli.js";
import { writesSettled } from "./pendingWrites.js";

/** Resolves once everything written to the stream so far has been handed to the OS. */
function flushed(stream: NodeJS.WriteStream): Promise<void> {
  return new Promise((resolve) => stream.write("", () => resolve()));
}

const code = await main(process.argv.slice(2));
// A save still running (a Settings change just before quitting the TUI) finishes first: exiting would cut it short.
// Only writes are waited for, never downloads, and not forever: a keyring stuck on an unlock prompt gives up.
const SAVE_WAIT_MS = 30_000;
if (!(await writesSettled(SAVE_WAIT_MS)))
  process.stderr.write(
    `bambu-hando: a save was still running after ${SAVE_WAIT_MS / 1000} s and may not have finished\n`,
  );
// Exit once the output is out rather than when the event loop empties: a download the user walked
// away from (the TUI quit while SpoolmanDB was still loading) would otherwise hold the process open
// until it times out. Flushing first keeps piped output (a JSON report) whole.
await Promise.all([flushed(process.stdout), flushed(process.stderr)]);
process.exit(code);
