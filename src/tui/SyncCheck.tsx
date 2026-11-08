// ABOUTME: TUI sync check screen: what doesn't line up between BambuStudio and SpoolEase, as a scrollable report.
// ABOUTME: Lines and key handling are pure functions so App's always-on useInput can drive them.

import { Box, type Key, Text } from "ink";

import type { CheckSection } from "../syncCheck.js";

/** Report lines on screen at once. */
export const CHECK_ROWS = 30;

export interface CheckLine {
  tone: "problem" | "note" | "ok" | "why" | "item";
  text: string;
}

export type CheckAction = { type: "scroll"; top: number } | { type: "back" } | { type: "again" } | { type: "quit" } | { type: "none" };

export function checkLines(sections: CheckSection[]): CheckLine[] {
  return sections.flatMap((section): CheckLine[] => {
    if (section.items.length === 0) return [{ tone: "ok", text: `✓ ${section.title}: none` }];
    return [
      { tone: section.problem ? "problem" : "note", text: `${section.problem ? "✗" : "!"} ${section.title}: ${section.items.length}` },
      { tone: "why", text: `  ${section.why}` },
      ...section.items.map((item): CheckLine => ({ tone: "item", text: `    ${item}` })),
    ];
  });
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function checkSummary(sections: CheckSection[]): string {
  const count = (problem: boolean) => sections.filter((s) => s.problem === problem).reduce((sum, s) => sum + s.items.length, 0);
  const problems = count(true);
  const notes = count(false);
  return problems + notes === 0 ? "Everything lines up" : `${plural(problems, "problem")}, ${plural(notes, "note")}`;
}

export function checkInput(top: number, input: string, key: Key, lineCount: number, rows: number = CHECK_ROWS): CheckAction {
  const last = Math.max(0, lineCount - rows);
  const scroll = (to: number): CheckAction => ({ type: "scroll", top: Math.max(0, Math.min(to, last)) });
  if (key.escape || input === "b") return { type: "back" };
  if (input === "r") return { type: "again" };
  if (input === "q") return { type: "quit" };
  if (key.upArrow) return scroll(top - 1);
  if (key.downArrow) return scroll(top + 1);
  if (key.pageUp) return scroll(top - rows);
  if (key.pageDown) return scroll(top + rows);
  return { type: "none" };
}

const TONES: Record<CheckLine["tone"], { color?: string; dim?: boolean }> = {
  problem: { color: "red" },
  note: { color: "yellow" },
  ok: { color: "green" },
  why: { dim: true },
  item: {},
};

interface Props {
  sections: CheckSection[];
  top: number;
  /** What was compared, e.g. "BambuStudio default · SpoolEase http://host:80". */
  compared: string;
  warnings: string[];
}

export function SyncCheck({ sections, top, compared, warnings }: Props) {
  const lines = checkLines(sections);
  const shown = lines.slice(top, top + CHECK_ROWS);
  const summary = checkSummary(sections);
  const more = lines.length - top - shown.length;

  return (
    <Box flexDirection="column">
      <Text bold>Sync check: {compared}</Text>
      <Text bold color={summary === "Everything lines up" ? "green" : undefined}>
        {summary}
      </Text>
      {warnings.map((w) => (
        <Text key={w} color="yellow">
          ! {w}
        </Text>
      ))}
      <Box flexDirection="column" marginY={1}>
        {top > 0 ? <Text dimColor>… {top} above</Text> : null}
        {shown.map((line, index) => (
          <Text key={top + index} wrap="truncate-end" color={TONES[line.tone].color} dimColor={TONES[line.tone].dim}>
            {line.text}
          </Text>
        ))}
        {more > 0 ? <Text dimColor>… {more} more</Text> : null}
      </Box>
      <Text dimColor>{lines.length > CHECK_ROWS ? "↑/↓ scroll · " : ""}[r] check again · [b] back to menu · [q] quit</Text>
    </Box>
  );
}
