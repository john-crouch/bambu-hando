// ABOUTME: TUI list of the preset folder's BambuStudio filament presets, to pick one to edit; typing filters.
// ABOUTME: Key handling is pure (presetListInput) so App's always-on useInput can drive it.

import { Box, type Key, Text } from "ink";

import type { UserPreset } from "../syncCheck.js";
import { listMove } from "./menu.js";
import { visibleRange } from "./Picker.js";
import { listRows } from "./screenSize.js";

const ROWS = 14;
// Title, the filter line with its margins, "… more" (or no matches), an error and the hint line, plus a
// spare line; warnings come on top.
const CHROME = 8;
const COLUMNS = { cursor: 2, name: 40, printer: 22, id: 10 } as const;

export interface PresetListState {
  cursor: number;
  filter: string;
  error: string;
}

export type PresetListAction = { type: "update"; state: PresetListState } | { type: "choose"; index: number } | { type: "back" } | { type: "none" };

export function initialPresetList(): PresetListState {
  return { cursor: 0, filter: "", error: "" };
}

/** Presets on screen at once in a terminal `height` rows tall, below `warnings` warning lines. */
export function presetListRows(height: number | undefined, warnings: number): number {
  return listRows(height, CHROME + warnings, ROWS);
}

/** The presets with every word of the filter in their name, printer or filament ID, ignoring case. */
export function presetMatches(presets: UserPreset[], filter: string): UserPreset[] {
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  return presets.filter((p) => {
    const text = `${p.name} ${p.printer} ${p.filamentId}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

export function presetListInput(state: PresetListState, input: string, key: Key, count: number, rows: number = ROWS): PresetListAction {
  const next = (changes: Partial<PresetListState>): PresetListAction => ({ type: "update", state: { ...state, error: "", ...changes } });
  if (key.escape) return state.filter ? next({ filter: "", cursor: 0 }) : { type: "back" };
  if (key.return) return count > 0 ? { type: "choose", index: Math.min(state.cursor, count - 1) } : { type: "none" };
  const moved = listMove(state.cursor, key, count, rows);
  if (moved !== null) return next({ cursor: moved });
  if (key.backspace || key.delete) return next({ filter: state.filter.slice(0, -1), cursor: 0 });
  if (input && !key.ctrl && !key.meta && !key.tab) return next({ filter: state.filter + input, cursor: 0 });
  return { type: "none" };
}

function Cell({ width, children, color, dim, shrink }: { width: number; children: string; color?: string; dim?: boolean; shrink?: boolean }) {
  return (
    <Box width={width} flexShrink={shrink ? 1 : 0} paddingRight={1}>
      <Text wrap="truncate-end" color={color} dimColor={dim}>
        {children}
      </Text>
    </Box>
  );
}

interface Props {
  /** The presets matching the filter. */
  matches: UserPreset[];
  total: number;
  folder: string;
  /** Paths of presets with edits not saved yet. */
  drafts: ReadonlySet<string>;
  state: PresetListState;
  warnings: string[];
  /** The terminal's height in rows, when known. */
  height?: number;
}

export function PresetList({ matches, total, folder, drafts, state, warnings, height }: Props) {
  const [start, end] = visibleRange(state.cursor, matches.length, presetListRows(height, warnings.length));
  return (
    <Box flexDirection="column">
      <Text bold wrap="truncate-end">
        Edit a filament preset: {state.filter ? `${matches.length} of ${total}` : total} in {folder}
      </Text>
      {warnings.map((w) => (
        <Text key={w} color="yellow" wrap="truncate-end">
          ! {w}
        </Text>
      ))}
      <Box marginY={1}>
        <Text>Filter: </Text>
        <Text color="cyan">{state.filter}</Text>
        <Text inverse> </Text>
      </Box>
      {matches.slice(start, end).map((preset, offset) => {
        const active = start + offset === state.cursor;
        return (
          <Box key={preset.path}>
            <Cell width={COLUMNS.cursor}>{active ? "›" : ""}</Cell>
            <Cell width={COLUMNS.name} color={active ? "cyan" : undefined} shrink>
              {preset.name}
            </Cell>
            <Cell width={COLUMNS.printer} dim>
              {preset.printer.replace(/^Bambu Lab /, "")}
            </Cell>
            <Cell width={COLUMNS.id} dim>
              {preset.filamentId || "no ID"}
            </Cell>
            <Text color="yellow">{drafts.has(preset.path) ? "• not saved" : ""}</Text>
          </Box>
        );
      })}
      {matches.length === 0 ? <Text dimColor>No preset matches every word of the filter.</Text> : null}
      {matches.length > end ? <Text dimColor>… {matches.length - end} more</Text> : null}
      {state.error ? <Text color="red">{state.error}</Text> : null}
      <Text dimColor>type to filter · ↑/↓ move · enter edit · esc {state.filter ? "clear filter" : "menu"} · ? help</Text>
    </Box>
  );
}
