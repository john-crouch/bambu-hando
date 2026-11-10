// ABOUTME: TUI list of every key in a BambuStudio filament preset, each value editable as raw text; typing filters.
// ABOUTME: Key handling is pure (rawInput) and shares the edits with the preset form.

import { Box, type Key, Text } from "ink";

import { type EditValue, type Edits, lockedReason, parseRaw, type Preset, rawText } from "../presetEdit.js";
import type { UserPreset } from "../syncCheck.js";
import { listMove } from "./menu.js";
import { visibleRange } from "./Picker.js";
import { lineInput, presetTitle } from "./PresetForm.js";
import { listRows } from "./screenSize.js";

const ROWS = 14;
// Title, the filter line with its margins, "… more" (or no matches), an error and the hint line, plus a spare line.
const CHROME = 8;
const COLUMNS = { cursor: 2, key: 38 } as const;

export interface RawSettingsState {
  cursor: number;
  filter: string;
  /** The text being typed for the key at the cursor; null when not editing. */
  editing: string | null;
  error: string;
}

export type RawAction =
  | { type: "update"; state: RawSettingsState }
  | { type: "set"; key: string; edit: EditValue; state: RawSettingsState }
  | { type: "undo"; key: string }
  | { type: "back" }
  | { type: "none" };

export function initialRawSettings(): RawSettingsState {
  return { cursor: 0, filter: "", editing: null, error: "" };
}

/** Keys on screen at once in a terminal `height` rows tall. */
export function rawRows(height?: number): number {
  return listRows(height, CHROME, ROWS);
}

/** The preset's keys, in its order, with every word of the filter in their name. */
export function rawKeys(preset: Preset, filter: string): string[] {
  const words = filter.toLowerCase().split(/[\s_]+/).filter(Boolean);
  return Object.keys(preset).filter((key) => words.every((word) => key.toLowerCase().includes(word)));
}

/** Whether keys go into a value being typed, where ? is typed rather than opening help. */
export function rawTyping(state: RawSettingsState): boolean {
  return state.editing !== null;
}

/** `keys`: the keys listed (rawKeys); `edited`: the preset with the edits so far. */
export function rawInput(state: RawSettingsState, input: string, key: Key, keys: string[], edited: Preset, rows: number = ROWS): RawAction {
  const next = (changes: Partial<RawSettingsState>): RawAction => ({ type: "update", state: { ...state, error: "", ...changes } });
  const current = keys[state.cursor];

  if (state.editing !== null) {
    if (current === undefined) return { type: "none" };
    const line = lineInput(state.editing, input, key);
    if (line.type === "cancel") return next({ editing: null });
    if (line.type === "update") return next({ editing: line.text });
    if (line.type === "none") return { type: "none" };
    const parsed = parseRaw(edited[current], line.text);
    if ("error" in parsed) return { type: "update", state: { ...state, editing: line.text, error: parsed.error } };
    return { type: "set", key: current, edit: parsed.edit, state: { ...state, editing: null, error: "" } };
  }

  if (key.escape) return state.filter ? next({ filter: "", cursor: 0 }) : { type: "back" };
  if (key.return) {
    if (current === undefined) return { type: "none" };
    const locked = lockedReason(current);
    if (locked) return next({ error: `${current} can't be changed here: ${locked}` });
    const text = rawText(edited[current]);
    return text === null ? next({ error: `${current} isn't text; change it in BambuStudio` }) : next({ editing: text });
  }
  if (key.ctrl && input === "u") return current === undefined ? { type: "none" } : { type: "undo", key: current };
  const moved = listMove(state.cursor, key, keys.length, rows);
  if (moved !== null) return next({ cursor: moved });
  if (key.backspace || key.delete) return next({ filter: state.filter.slice(0, -1), cursor: 0 });
  if (input && !key.ctrl && !key.meta && !key.tab) return next({ filter: state.filter + input, cursor: 0 });
  return { type: "none" };
}

interface Props {
  preset: UserPreset;
  /** The preset with the edits. */
  edited: Preset;
  edits: Edits;
  state: RawSettingsState;
  /** The terminal's height in rows, when known. */
  height?: number;
}

export function RawSettings({ preset, edited, edits, state, height }: Props) {
  const keys = rawKeys(edited, state.filter);
  const [start, end] = visibleRange(state.cursor, keys.length, rawRows(height));
  return (
    <Box flexDirection="column">
      <Text bold wrap="truncate-end">
        All settings: {presetTitle(preset)}
      </Text>
      <Box marginY={1}>
        <Text>Filter: </Text>
        <Text color="cyan">{state.filter}</Text>
        <Text inverse> </Text>
        <Text dimColor>{state.filter ? `  ${keys.length} of ${Object.keys(edited).length}` : ""}</Text>
      </Box>
      {keys.slice(start, end).map((key, offset) => {
        const active = start + offset === state.cursor;
        const editing = active && state.editing !== null;
        const value = rawText(edited[key]) ?? JSON.stringify(edited[key]);
        return (
          <Box key={key}>
            <Box width={COLUMNS.cursor} flexShrink={0}>
              <Text>{active ? "›" : ""}</Text>
            </Box>
            <Box width={COLUMNS.key} flexShrink={0} paddingRight={1}>
              <Text wrap="truncate-end" color={active ? "cyan" : undefined} dimColor={!active && Boolean(lockedReason(key))}>
                {key}
              </Text>
            </Box>
            {editing ? (
              <Text wrap="truncate-start">
                <Text color="cyan">{state.editing}</Text>
                <Text inverse> </Text>
              </Text>
            ) : (
              <Text wrap="truncate-end" color={edits.has(key) ? "yellow" : undefined} dimColor={!edits.has(key) && Boolean(lockedReason(key))}>
                {value === "" ? '""' : value}
              </Text>
            )}
          </Box>
        );
      })}
      {keys.length === 0 ? <Text dimColor>No key has every word of the filter.</Text> : null}
      {keys.length > end ? <Text dimColor>… {keys.length - end} more</Text> : null}
      {state.error ? (
        <Text color="red" wrap="truncate-end">
          {state.error}
        </Text>
      ) : null}
      <Text dimColor>
        {state.editing !== null
          ? "type the value (\\n starts a new line) · enter set · esc leave as it was"
          : "type to filter · enter edit · ctrl+u undo · esc " + (state.filter ? "clear filter" : "back to the form") + " · ? help"}
      </Text>
    </Box>
  );
}
