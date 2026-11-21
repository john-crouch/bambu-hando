// ABOUTME: Mounts the full-screen Ink TUI (alternate screen) in the real terminal and waits for it to exit.
// ABOUTME: Loaded lazily by the CLI so headless runs never import React or Ink; prints the session's run summaries after.

import { ThemeProvider } from "@inkjs/ui";
import { render } from "ink";

import { Shell } from "./app/Shell.js";
import { summaryText } from "./app/shell.js";
import { theme } from "./app/stub-ui.js";
import type { RunSummary } from "./core/types.js";
import type { FormValues } from "./core/values.js";

// Conventional exit status for a process interrupted by SIGINT (128 + 2).
const INTERRUPTED = 130;

export async function runTui(initial: FormValues): Promise<number> {
  // Stays undefined when Ink exits on ctrl+c instead of through onExit.
  let code: number | undefined;
  let summaries: RunSummary[] = [];
  const instance = render(
    <ThemeProvider theme={theme}>
      <Shell
        initial={initial}
        start={{ query: initial.query }}
        onExit={(exitCode) => {
          code = exitCode;
          instance.unmount();
        }}
        onSummaries={(latest) => {
          summaries = latest;
        }}
      />
    </ThemeProvider>,
    { alternateScreen: true },
  );
  await instance.waitUntilExit();
  // The alternate screen is gone: what the runs did goes to the normal screen.
  const text = summaryText(summaries);
  if (text) process.stdout.write(text);
  return code ?? INTERRUPTED;
}
