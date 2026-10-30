// ABOUTME: SpoolmanDB filament picker: type to search, tab to select, enter to continue.
// ABOUTME: Key handling is a pure function so App's always-on useInput can drive it without a listener of its own.

import { Box, type Key, Text } from "ink";

import type { FilamentProfile } from "../models.js";

const ROWS = 12;
const COLUMNS = { cursor: 2, mark: 4, swatch: 3, name: 46, material: 8, temps: 9, code: 10 } as const;

export interface PickerState {
  query: string;
  /** Index into the current matches. */
  cursor: number;
  /** Selected filament IDs; kept while filtered out of view. */
  selected: ReadonlySet<string>;
  error: string;
}

export type PickerAction = { type: "update"; state: PickerState } | { type: "done" } | { type: "back" };

export function initialPickerState(query: string): PickerState {
  return { query, cursor: 0, selected: new Set(), error: "" };
}

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(value, max));
}

export function pickerInput(state: PickerState, input: string, key: Key, matches: FilamentProfile[]): PickerAction {
  const last = matches.length - 1;
  const next = (changes: Partial<PickerState>): PickerAction => ({ type: "update", state: { ...state, error: "", ...changes } });

  if (key.escape) return { type: "back" };
  if (key.return) {
    if (state.selected.size === 0) return next({ error: "Select filaments with tab (ctrl+a selects every match)" });
    return { type: "done" };
  }
  if (key.upArrow) return next({ cursor: clamp(state.cursor - 1, last) });
  if (key.downArrow) return next({ cursor: clamp(state.cursor + 1, last) });
  if (key.pageUp) return next({ cursor: clamp(state.cursor - ROWS, last) });
  if (key.pageDown) return next({ cursor: clamp(state.cursor + ROWS, last) });
  if (key.tab) {
    const current = matches[state.cursor];
    if (!current) return next({});
    const selected = new Set(state.selected);
    if (!selected.delete(current.filamentId)) selected.add(current.filamentId);
    return next({ selected, cursor: clamp(state.cursor + 1, last) });
  }
  if (key.ctrl && input === "a") {
    const selected = new Set(state.selected);
    const allSelected = matches.every((p) => selected.has(p.filamentId));
    for (const p of matches) {
      if (allSelected) selected.delete(p.filamentId);
      else selected.add(p.filamentId);
    }
    return next({ selected });
  }
  if (key.backspace || key.delete) return next({ query: state.query.slice(0, -1), cursor: 0 });
  if (input && !key.ctrl && !key.meta) return next({ query: state.query + input, cursor: 0 });
  return next({});
}

/** [start, end) of the rows to show, keeping the cursor in view and centered when possible. */
export function visibleRange(cursor: number, total: number, rows: number): [number, number] {
  const start = clamp(cursor - Math.floor(rows / 2), Math.max(0, total - rows));
  return [start, Math.min(total, start + rows)];
}

function Cell({ width, children, dim }: { width: number; children: string; dim?: boolean }) {
  return (
    <Box width={width}>
      <Text wrap="truncate-end" dimColor={dim}>
        {children}
      </Text>
    </Box>
  );
}

interface Props {
  catalogSize: number;
  matches: FilamentProfile[];
  state: PickerState;
  warnings: string[];
}

export function Picker({ catalogSize, matches, state, warnings }: Props) {
  const [start, end] = visibleRange(state.cursor, matches.length, ROWS);

  return (
    <Box flexDirection="column">
      <Text bold>
        SpoolmanDB: {catalogSize} filaments · {matches.length} match · {state.selected.size} selected
      </Text>
      {warnings.map((w) => (
        <Text key={w} color="yellow">
          ! {w}
        </Text>
      ))}
      <Box marginY={1}>
        <Text>Search: </Text>
        <Text color="cyan">{state.query}</Text>
        <Text inverse> </Text>
      </Box>
      {matches.slice(start, end).map((profile, offset) => {
        const index = start + offset;
        const active = index === state.cursor;
        return (
          <Box key={profile.filamentId}>
            <Cell width={COLUMNS.cursor}>{active ? "›" : ""}</Cell>
            <Cell width={COLUMNS.mark}>{state.selected.has(profile.filamentId) ? "[x]" : "[ ]"}</Cell>
            <Box width={COLUMNS.swatch}>
              <Text backgroundColor={`#${profile.colorRgba.slice(0, 6)}`}>{"  "}</Text>
            </Box>
            <Box width={COLUMNS.name}>
              <Text wrap="truncate-end" color={active ? "cyan" : undefined}>
                {profile.name}
              </Text>
            </Box>
            <Cell width={COLUMNS.material}>{profile.material}</Cell>
            <Cell width={COLUMNS.temps}>{`${profile.nozzleTempMin}-${profile.nozzleTempMax}`}</Cell>
            <Cell width={COLUMNS.code} dim>
              {profile.filamentId}
            </Cell>
          </Box>
        );
      })}
      {matches.length === 0 ? <Text dimColor>No matches. Bambu Lab filaments are never included: BambuStudio ships its own presets.</Text> : null}
      {matches.length > end ? <Text dimColor>… {matches.length - end} more</Text> : null}
      {state.error ? <Text color="red">{state.error}</Text> : null}
      <Text dimColor>type to search · ↑/↓ move · tab select · ctrl+a select all matches · enter continue · esc back</Text>
    </Box>
  );
}
