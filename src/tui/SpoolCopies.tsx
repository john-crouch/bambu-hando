// ABOUTME: TUI screen for more spools of a filament the console has: what will be copied, live results, then labels.
// ABOUTME: Rendering only; App drives the keys and the SpoolEase writes.

import { Box, Text } from "ink";
import type { CopyableFilament } from "../spoolCopies.js";
import type { SpoolEaseWrite } from "../spoolease.js";
import { Busy } from "./Busy.js";

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** "1000 g on a 189 g spool", leaving out what the spool doesn't know. */
export function weightSummary(labelWeight: number | null, coreWeight: number | null): string {
  const net = labelWeight ? `${labelWeight} g` : "unknown weight";
  return coreWeight ? `${net} on a ${coreWeight} g spool` : `${net}, empty spool weight unknown`;
}

interface Props {
  filament: CopyableFilament;
  count: number;
  /** Where the spools go, e.g. http://host:port. */
  target: string;
  /** null before applying; one entry per copy made so far while running and after. */
  results: SpoolEaseWrite[] | null;
  running: boolean;
  /** What the last labels made from this screen did. */
  outcome: { ok: boolean; lines: string[] } | null;
}

export function SpoolCopies({ filament, count, target, results, running, outcome }: Props) {
  const { spool } = filament;
  const created = (results ?? []).flatMap((r) => (r.ok ? [r.id] : []));
  const failed = (results ?? []).filter((r) => !r.ok).length;
  const done = results !== null && !running;
  const color = spool.colorCodes[0]?.slice(0, 6);

  return (
    <Box flexDirection="column">
      <Text bold>
        Add {plural(count, "spool")} of {filament.name}
      </Text>
      <Text>
        SpoolEase: {target} · copies of spool #{spool.id} ({plural(filament.count, "spool")} of it
        now)
      </Text>
      <Box marginY={1}>
        {color ? <Text backgroundColor={`#${color}`}>{"  "}</Text> : null}
        <Text>
          {color ? " " : ""}
          {[spool.brand, spool.material, spool.colorName].filter(Boolean).join(" · ")} ·{" "}
          {weightSummary(spool.labelWeight, spool.coreWeight)} · {filament.code}
        </Text>
      </Box>
      {(results ?? []).map((result, index) =>
        result.ok ? (
          <Text
            // biome-ignore lint/suspicious/noArrayIndexKey: SpoolEase can reply without an id (write returns ""), so the copy number is the row's identity; results only grow, in order.
            key={`added-${index}`}
            color="green"
          >
            ✓ spool #{result.id} added
          </Text>
        ) : (
          <Text
            // biome-ignore lint/suspicious/noArrayIndexKey: a failed copy has no spool ID; its copy number (index + 1, shown in the row) is its identity, and results only grow, in order.
            key={`failed-${index}`}
            color="red"
          >
            ✗ spool {index + 1} of {count}: {result.error}
          </Text>
        ),
      )}
      {running ? <Busy color="cyan" message="Adding spools to SpoolEase…" /> : null}
      {done ? (
        <Text bold color={failed ? "red" : "green"}>
          Done: {created.length} added, {failed} failed
        </Text>
      ) : null}
      {outcome?.lines.map((line) => (
        <Text key={line} color={outcome.ok ? "green" : "red"}>
          {outcome.ok ? "✓" : "✗"} {line}
        </Text>
      ))}
      {results === null ? (
        <Text dimColor>[a] add · [b] back to how many · [q] quit · ? help</Text>
      ) : null}
      {done ? (
        <Text dimColor>
          {created.length > 0
            ? `[l] labels for ${plural(created.length, "new spool")} · [m] menu · [q] quit · ? help`
            : "[m] menu · [q] quit · ? help"}
        </Text>
      ) : null}
    </Box>
  );
}
