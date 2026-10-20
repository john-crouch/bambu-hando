// ABOUTME: Mounts the Ink TUI in the real terminal and waits for it to exit.
// ABOUTME: Loaded lazily by the CLI so headless runs never import React or Ink.

import { render } from "ink";

import { App, type FormValues } from "./App.js";

export async function runTui(initial: FormValues): Promise<number> {
  let code = 0;
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
  return code;
}
