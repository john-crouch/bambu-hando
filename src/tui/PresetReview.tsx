// ABOUTME: TUI review of a preset edit before it's saved: each change, the presets it goes into, SpoolEase's range.
// ABOUTME: [a] saves; afterwards each preset's result shows here.

import { Box, Text } from "ink";

import type { EditChange, EditResult } from "../presetEdit.js";
import type { UserPreset } from "../syncCheck.js";
import { Busy } from "./Busy.js";
import { presetTitle } from "./PresetForm.js";

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** SpoolEase's custom filament row whose nozzle range the save changes too. */
export interface RangeChange {
  code: string;
  from: string;
  to: string;
  low: number;
  high: number;
}

interface Props {
  preset: UserPreset;
  changes: EditChange[];
  targets: UserPreset[];
  spoolease: RangeChange | null;
  /** Why SpoolEase's range stays as it is, when it can't be checked. */
  warning: string;
  /** null until saved. */
  results: EditResult[] | null;
  spooleaseResult: { ok: boolean; line: string } | null;
  running: boolean;
}

export function PresetReview({ preset, changes, targets, spoolease, warning, results, spooleaseResult, running }: Props) {
  // Indent, the longest entry, and a gap.
  const labelWidth = Math.min(32, 2 + Math.max(...changes.map((c) => c.label.length)) + 2);
  const targetWidth = Math.min(60, 2 + Math.max(...targets.map((t) => presetTitle(t).length)) + 2);
  const failed = results?.filter((r) => !r.ok) ?? [];
  return (
    <Box flexDirection="column">
      <Text bold wrap="truncate-end">
        Save {plural(changes.length, "change")} to {presetTitle(preset)}
      </Text>
      <Box flexDirection="column" marginY={1}>
        {changes.map((change) => (
          <Box key={change.key}>
            <Box width={labelWidth} flexShrink={0} paddingLeft={2} paddingRight={1}>
              <Text wrap="truncate-end">{change.label}</Text>
            </Box>
            <Text wrap="truncate-end">
              <Text dimColor>{change.from}</Text> → <Text color="yellow">{change.to}</Text>
            </Text>
          </Box>
        ))}
      </Box>
      <Text>Into {plural(targets.length, "preset")}:</Text>
      <Box flexDirection="column" marginBottom={1}>
        {targets.map((target, index) => {
          const result = results?.[index];
          return (
            <Box key={target.path}>
              <Box width={targetWidth} flexShrink={0} paddingLeft={2} paddingRight={1}>
                <Text wrap="truncate-end">{presetTitle(target)}</Text>
              </Box>
              {result ? (
                <Text color={result.ok ? (result.detail ? "yellow" : "green") : "red"} wrap="truncate-end">
                  {result.ok ? `✓ ${result.detail || "saved"}` : `✗ ${result.detail}`}
                </Text>
              ) : null}
            </Box>
          );
        })}
      </Box>
      {spoolease ? (
        <Text wrap="truncate-end">
          SpoolEase: custom filament {spoolease.code}'s nozzle range {spoolease.from} → <Text color="yellow">{spoolease.to}</Text>
        </Text>
      ) : null}
      {spooleaseResult ? (
        <Text color={spooleaseResult.ok ? "green" : "red"} wrap="truncate-end">
          {spooleaseResult.ok ? "✓" : "✗"} {spooleaseResult.line}
        </Text>
      ) : null}
      {warning ? (
        <Text color="yellow" wrap="truncate-end">
          ! {warning}
        </Text>
      ) : null}
      {results === null ? (
        <Box flexDirection="column">
          <Text dimColor>Close BambuStudio first: it may save its own copy over these presets.</Text>
          <Text dimColor>Logged in to Bambu, BambuStudio uploads the change on its next sync.</Text>
        </Box>
      ) : null}
      {running ? <Busy color="cyan" message="Saving…" /> : null}
      {results && !running ? (
        <Text bold color={failed.length ? "red" : "green"}>
          Done: {plural(results.length - failed.length, "preset")} saved, {failed.length} failed
        </Text>
      ) : null}
      {results === null ? (
        <Text dimColor>[a] save · [b] back to editing · [q] quit · ? help</Text>
      ) : running ? null : (
        <Text dimColor>[e] edit another preset · [m] menu · [q] quit · ? help</Text>
      )}
    </Box>
  );
}
