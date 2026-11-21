// ABOUTME: TUI screen that gives BambuStudio presets without a filament ID one: each file and its ID, then [a] writes.
// ABOUTME: Opened from the sync check; returning to it checks again.

import { basename } from "node:path";

import { Box, Text } from "ink";

import type { IdFix, IdFixResult } from "../presetIds.js";
import { Busy } from "./Busy.js";

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

interface Props {
  fixes: IdFix[];
  /** null until written. */
  results: IdFixResult[] | null;
  running: boolean;
}

export function PresetIds({ fixes, results, running }: Props) {
  const fileWidth =
    Math.min(64, 2 + Math.max(...fixes.map((fix) => basename(fix.path).length))) + 1;
  const failed = results?.filter((r) => !r.ok) ?? [];
  return (
    <Box flexDirection="column">
      <Text bold>Give {plural(fixes.length, "BambuStudio preset")} a filament ID</Text>
      <Text dimColor>
        Each gets the ID BambuStudio's Create filament gives a filament of that name, so spools can
        find it.
      </Text>
      <Text dimColor>
        Logged in to Bambu, BambuStudio uploads the change on its next sync; restart it to load the
        change.
      </Text>
      <Box flexDirection="column" marginY={1}>
        {fixes.map((fix, index) => {
          const result = results?.[index];
          return (
            <Box key={fix.path}>
              <Box width={fileWidth} flexShrink={0} paddingRight={1}>
                <Text wrap="truncate-end">{basename(fix.path)}</Text>
              </Box>
              <Box width={10} flexShrink={0}>
                <Text color="cyan">{fix.id}</Text>
              </Box>
              {result ? (
                <Text color={result.ok ? "green" : "red"} wrap="truncate-end">
                  {result.ok ? "✓ written" : `✗ ${result.detail}`}
                </Text>
              ) : null}
            </Box>
          );
        })}
      </Box>
      {running ? <Busy color="cyan" message="Writing presets…" /> : null}
      {results && !running ? (
        <Text bold color={failed.length ? "red" : "green"}>
          Done: {plural(results.length - failed.length, "preset")} given an ID, {failed.length}{" "}
          failed
        </Text>
      ) : null}
      {results === null ? (
        <Text dimColor>[a] write · [b] back to the check · [q] quit · ? help</Text>
      ) : running ? null : (
        <Text dimColor>[b] back to the check (checks again) · [m] menu · [q] quit · ? help</Text>
      )}
    </Box>
  );
}
