// ABOUTME: Mounts the Ink TUI in the real terminal and waits for it to exit.
// ABOUTME: Loaded lazily by the CLI so headless runs never import React or Ink.

import { render } from "ink";

import { App, type FormValues } from "./App.js";

// Conventional exit status for a process interrupted by SIGINT (128 + 2).
const INTERRUPTED = 130;

export async function runTui(initial: FormValues): Promise<number> {
  // Stays undefined when Ink exits on ctrl+c instead of through onExit.
  let code: number | undefined;
  const instance = render(
    <App
      initial={initial}
      onExit={(exitCode) => {
        code = exitCode;
        instance.unmount();
      }}
    />,
  );
  await instance.waitUntilExit();
  return code ?? INTERRUPTED;
}
