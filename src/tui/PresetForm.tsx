// ABOUTME: TUI form for editing a BambuStudio filament preset: the curated fields by group, All settings, then review.
// ABOUTME: Key handling is pure (presetFormInput, and lineInput for the value being typed, shared with All settings).

import { Box, type Key, Text } from "ink";

import { type EditField, EDIT_FIELDS, type Edits, fieldText, parseField, type Preset, shownValue } from "../presetEdit.js";
import { tildePath } from "../paths.js";
import type { UserPreset } from "../syncCheck.js";
import { listMove } from "./menu.js";
import { visibleRange } from "./Picker.js";
import { listRows } from "./screenSize.js";

export const ALL_ROW = EDIT_FIELDS.length;
export const SAVE_ROW = ALL_ROW + 1;

const ROWS = 16;
// Title, the file line, the list's margins, "… more", an error and the hint line, plus a spare line.
const CHROME = 8;
const COLUMNS = { cursor: 2, group: 12, label: 27, value: 22 } as const;

/** Rows on screen at once in a terminal `height` rows tall. */
export function presetFormRows(height?: number): number {
  return listRows(height, CHROME, ROWS);
}

export type LineAction = { type: "update"; text: string } | { type: "commit"; text: string } | { type: "cancel" } | { type: "none" };

/** A value being typed on one line: enter sets it, esc leaves the value as it was. */
export function lineInput(text: string, input: string, key: Key): LineAction {
  if (key.escape) return { type: "cancel" };
  if (key.return) return { type: "commit", text };
  if (key.backspace || key.delete) return { type: "update", text: text.slice(0, -1) };
  if (!input || key.ctrl || key.meta || key.tab) return { type: "none" };
  // Pasted text arrives as one input; a newline at its end sets it, as enter would.
  const end = input.search(/[\r\n]/);
  if (end >= 0) return { type: "commit", text: text + input.slice(0, end) };
  return { type: "update", text: text + input };
}

export interface PresetFormState {
  cursor: number;
  /** The text being typed for the field at the cursor; null when not editing. */
  editing: string | null;
  error: string;
}

export type PresetFormAction =
  | { type: "update"; state: PresetFormState }
  | { type: "set"; key: string; edit: { every: string }; state: PresetFormState }
  | { type: "undo"; key: string }
  | { type: "raw" }
  | { type: "review" }
  | { type: "back" }
  | { type: "none" };

export function initialPresetForm(): PresetFormState {
  return { cursor: 0, editing: null, error: "" };
}

/** Whether keys go into a value being typed, where ? is typed rather than opening help. */
export function presetFormTyping(state: PresetFormState): boolean {
  return state.editing !== null;
}

/** `edited`: the preset with the edits so far, whose values the fields start from. */
export function presetFormInput(state: PresetFormState, input: string, key: Key, edited: Preset, rows: number = ROWS): PresetFormAction {
  const next = (changes: Partial<PresetFormState>): PresetFormAction => ({ type: "update", state: { ...state, error: "", ...changes } });
  const field = EDIT_FIELDS[state.cursor];

  if (state.editing !== null) {
    if (!field) return { type: "none" };
    const line = lineInput(state.editing, input, key);
    if (line.type === "cancel") return next({ editing: null });
    if (line.type === "update") return next({ editing: line.text });
    if (line.type === "none") return { type: "none" };
    const parsed = parseField(field, line.text);
    if ("error" in parsed) return { type: "update", state: { ...state, editing: line.text, error: parsed.error } };
    return { type: "set", key: field.key, edit: { every: parsed.value }, state: { ...state, editing: null, error: "" } };
  }

  if (key.escape) return { type: "back" };
  const moved = listMove(state.cursor, key, SAVE_ROW + 1, rows);
  if (moved !== null) return next({ cursor: moved });
  if (key.return) {
    if (state.cursor === ALL_ROW) return { type: "raw" };
    if (state.cursor === SAVE_ROW) return { type: "review" };
    if (!field) return { type: "none" };
    if (field.kind === "switch") {
      const on = fieldText(field, edited[field.key]) === "1";
      return { type: "set", key: field.key, edit: { every: on ? "0" : "1" }, state: { ...state, error: "" } };
    }
    return next({ editing: fieldText(field, edited[field.key]) });
  }
  if (field && (input === "u" || (key.ctrl && input === "u")) && !key.meta) return { type: "undo", key: field.key };
  return { type: "none" };
}

function hint(field: EditField): string {
  const nil = field.nilable ? "; nothing: printer's" : "";
  switch (field.kind) {
    case "int":
      return `whole number, ${field.min}-${field.max}${nil}`;
    case "decimal":
      return `number, ${field.min}-${field.max}${nil}`;
    case "color":
      return "6 hex digits; nothing: none";
    case "text":
      return "\\n starts a new line";
    case "switch":
      return "";
  }
}

/** A name plus its printer, as the edit screens title it. */
export function presetTitle(preset: UserPreset): string {
  return preset.printer ? `${preset.name} @ ${preset.printer.replace(/^Bambu Lab /, "")}` : preset.name;
}

function Cell({ width, children, color, dim, bold }: { width: number; children: React.ReactNode; color?: string; dim?: boolean; bold?: boolean }) {
  return (
    <Box width={width} flexShrink={0} paddingRight={1}>
      <Text wrap="truncate-end" color={color} dimColor={dim} bold={bold}>
        {children}
      </Text>
    </Box>
  );
}

interface Props {
  preset: UserPreset;
  /** The preset as it is on disk. */
  original: Preset;
  /** The preset with the edits. */
  edited: Preset;
  edits: Edits;
  state: PresetFormState;
  /** Opened from the plan: the preset is the one the run writes, and the form goes back to the plan. */
  planned?: boolean;
  /** The terminal's height in rows, when known. */
  height?: number;
}

export function PresetForm({ preset, original, edited, edits, state, planned = false, height }: Props) {
  const rows = presetFormRows(height);
  const [start, end] = visibleRange(state.cursor, SAVE_ROW + 1, rows);
  const unsaved = edits.size;
  const typing = state.editing !== null ? EDIT_FIELDS[state.cursor] : undefined;

  const lines = Array.from({ length: end - start }, (_, offset) => {
    const index = start + offset;
    const active = index === state.cursor;
    const marker = <Cell width={COLUMNS.cursor}>{active ? "›" : ""}</Cell>;
    if (index >= ALL_ROW) {
      const label = index === ALL_ROW ? "All settings…" : planned ? "Back to the plan" : "Review and save";
      const detail = index === ALL_ROW ? "every key in the preset, as text" : unsaved ? `${unsaved} change${unsaved === 1 ? "" : "s"}` : "nothing changed yet";
      return (
        <Box key={label} marginTop={index === ALL_ROW ? 1 : 0}>
          {marker}
          <Cell width={COLUMNS.group}>{""}</Cell>
          <Cell width={COLUMNS.label} color={active ? "cyan" : undefined}>
            {label}
          </Cell>
          <Text dimColor wrap="truncate-end">
            {detail}
          </Text>
        </Box>
      );
    }
    const field = EDIT_FIELDS[index]!;
    const firstOfGroup = index === start || EDIT_FIELDS[index - 1]!.group !== field.group;
    const changed = edits.has(field.key);
    const editing = active && state.editing !== null;
    return (
      <Box key={field.key}>
        {marker}
        <Cell width={COLUMNS.group} dim>
          {firstOfGroup ? field.group : ""}
        </Cell>
        <Cell width={COLUMNS.label} color={active ? "cyan" : undefined}>
          {field.label}
        </Cell>
        <Box width={COLUMNS.value} flexShrink={0} paddingRight={1}>
          {editing ? (
            <Text wrap="truncate-start">
              <Text color="cyan">{state.editing}</Text>
              <Text inverse> </Text>
            </Text>
          ) : (
            <Text wrap="truncate-end" color={changed ? "yellow" : undefined}>
              {shownValue(field, edited[field.key])}
            </Text>
          )}
        </Box>
        <Text dimColor wrap="truncate-end">
          {changed ? `was ${shownValue(field, original[field.key])}` : ""}
        </Text>
      </Box>
    );
  });

  return (
    <Box flexDirection="column">
      <Text bold>Edit {presetTitle(preset)}</Text>
      <Text dimColor wrap="truncate-start">
        {tildePath(preset.path)}
        {planned ? " · the run writes it" : ""}
      </Text>
      <Box flexDirection="column" marginY={1}>
        {lines}
        {SAVE_ROW + 1 > end ? <Text dimColor>… {SAVE_ROW + 1 - end} more</Text> : null}
      </Box>
      {state.error ? <Text color="red">{state.error}</Text> : null}
      <Text dimColor>
        {typing
          ? `${hint(typing) || "type the value"} · enter set · esc leave as it was`
          : `↑/↓ move · enter edit · u undo · esc back to ${planned ? "the plan" : "presets"} · ? help`}
      </Text>
    </Box>
  );
}
