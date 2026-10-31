// ABOUTME: TUI label screen: field checkboxes, label size, printer and PDF path for the spools a sync created.
// ABOUTME: Key handling and validation are pure functions so App's always-on useInput can drive them.

import { homedir } from "node:os";
import { join } from "node:path";

import { Box, type Key, Text } from "ink";

import type { LabelTarget } from "../labelJob.js";
import type { LabelSettings } from "../labelSettings.js";
import { LABEL_FIELDS, type LabelField, parseLabelSize } from "../labels.js";

export const SIZE_ROW = LABEL_FIELDS.length;
export const PRINTER_ROW = SIZE_ROW + 1;
export const OUTPUT_ROW = PRINTER_ROW + 1;

export interface LabelFormState {
  fields: LabelField[];
  size: string;
  /** CUPS destinations to choose from. */
  printers: string[];
  /** "" when the labels are only written to a PDF. */
  printer: string;
  output: string;
  cursor: number;
  error: string;
}

export type LabelFormAction = { type: "update"; state: LabelFormState } | { type: "submit" } | { type: "back" };

export function initialLabelForm(saved: LabelSettings, printers: string[]): LabelFormState {
  return {
    fields: saved.fields,
    size: saved.size,
    printers: saved.printer && !printers.includes(saved.printer) ? [...printers, saved.printer] : printers,
    printer: saved.printer,
    output: saved.output,
    cursor: 0,
    error: "",
  };
}

function toggle(fields: LabelField[], field: LabelField): LabelField[] {
  const on = fields.includes(field) ? fields.filter((f) => f !== field) : [...fields, field];
  return LABEL_FIELDS.map((f) => f.key).filter((key) => on.includes(key));
}

function cyclePrinter(state: LabelFormState, step: number): string {
  const choices = ["", ...state.printers];
  const index = Math.max(0, choices.indexOf(state.printer));
  return choices[(index + step + choices.length) % choices.length]!;
}

export function labelFormInput(state: LabelFormState, input: string, key: Key): LabelFormAction {
  const next = (changes: Partial<LabelFormState>): LabelFormAction => ({ type: "update", state: { ...state, error: "", ...changes } });
  const field = LABEL_FIELDS[state.cursor]?.key;
  const text = state.cursor === SIZE_ROW ? "size" : state.cursor === OUTPUT_ROW ? "output" : null;

  if (key.escape) return { type: "back" };
  if (key.return) return { type: "submit" };
  if (key.upArrow) return next({ cursor: Math.max(0, state.cursor - 1) });
  if (key.downArrow) return next({ cursor: Math.min(OUTPUT_ROW, state.cursor + 1) });
  if (state.cursor === PRINTER_ROW && (key.leftArrow || key.rightArrow || input === " ")) {
    return next({ printer: cyclePrinter(state, key.leftArrow ? -1 : 1) });
  }
  if (field && input === " ") return next({ fields: toggle(state.fields, field) });
  if (text && (key.backspace || key.delete)) return next({ [text]: state[text].slice(0, -1) });
  if (text && input && !key.ctrl && !key.meta) return next({ [text]: state[text] + input });
  return { type: "update", state };
}

function expandHome(path: string, home: string): string {
  return path === "~" || path.startsWith("~/") ? join(home, path.slice(1)) : path;
}

export function labelFormTarget(state: LabelFormState, home = homedir()): { target: LabelTarget } | { error: string } {
  if (state.fields.length === 0) return { error: "Pick at least one field" };
  let size;
  try {
    size = parseLabelSize(state.size);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  const output = state.output.trim();
  if (!state.printer && !output) return { error: "Choose a printer, a PDF path, or both" };
  return { target: { fields: state.fields, size, output: output ? expandHome(output, home) : "", printer: state.printer, printOptions: [] } };
}

export function labelFormSettings(state: LabelFormState): LabelSettings {
  return { fields: state.fields, size: state.size, printer: state.printer, output: state.output };
}

const KEY_WIDTH = 12;

interface Props {
  state: LabelFormState;
  spoolIds: string[];
}

export function LabelForm({ state, spoolIds }: Props) {
  const row = (index: number, label: string, value: string, hint = "") => {
    const active = state.cursor === index;
    return (
      <Box key={label}>
        <Box width={2}>
          <Text>{active ? "›" : ""}</Text>
        </Box>
        <Box width={KEY_WIDTH}>
          <Text color={active ? "cyan" : undefined}>{label}</Text>
        </Box>
        <Text>{value}</Text>
        {hint ? <Text dimColor> {hint}</Text> : null}
      </Box>
    );
  };

  return (
    <Box flexDirection="column">
      <Text bold>
        Labels for {spoolIds.length} new spool{spoolIds.length === 1 ? "" : "s"}: {spoolIds.map((id) => `#${id}`).join(", ")}
      </Text>
      <Box flexDirection="column" marginY={1}>
        {LABEL_FIELDS.map((f, i) => row(i, `[${state.fields.includes(f.key) ? "x" : " "}] ${f.key}`, "", f.description))}
      </Box>
      {row(SIZE_ROW, "Size", state.size, "e.g. 57x32mm or 2.25x1.25in")}
      {row(PRINTER_ROW, "Printer", state.printer ? `‹ ${state.printer} ›` : "‹ don't print ›")}
      {row(OUTPUT_ROW, "Save PDF", state.output || "(don't save)")}
      {state.error ? (
        <Text color="red" wrap="wrap">
          {state.error}
        </Text>
      ) : null}
      <Box marginTop={1}>
        <Text dimColor>↑/↓ move · space toggle · ←/→ printer · type to edit · enter make labels · esc back</Text>
      </Box>
    </Box>
  );
}
