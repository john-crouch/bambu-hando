// ABOUTME: TUI inventory of the console's spools: what's left on each with a fill bar, where it is, when it was added.
// ABOUTME: Typing filters, tab changes the sort, enter acts on a spool; key handling is pure for App's useInput.

import { Box, type Key, Text } from "ink";

import { INVENTORY_SORTS, type InventoryRow, type InventorySort } from "../spoolInventory.js";
import { listMove } from "./menu.js";
import { visibleRange } from "./Picker.js";
import { listRows } from "./screenSize.js";

const ROWS = 14;
// Title, the filter line with its margins, the column header, "… more" (or no matches) and the hint line,
// plus a spare line.
const CHROME = 8;
const COLUMNS = {
  cursor: 2,
  swatch: 3,
  id: 6,
  name: 34,
  left: 8,
  bar: 11,
  location: 16,
  added: 11,
} as const;
const BAR_CELLS = 10;

const SORT_LABELS: Record<InventorySort, string> = {
  newest: "newest first",
  name: "by name",
  left: "least left first",
  location: "by location",
};

export interface SpoolListState {
  cursor: number;
  filter: string;
  sort: InventorySort;
}

export type SpoolListAction =
  | { type: "update"; state: SpoolListState }
  | { type: "choose"; index: number }
  | { type: "back" }
  | { type: "none" };

export function initialSpoolList(): SpoolListState {
  return { cursor: 0, filter: "", sort: "newest" };
}

/** Spools on screen at once in a terminal `height` rows tall. */
export function spoolListRows(height?: number): number {
  return listRows(height, CHROME, ROWS);
}

export function spoolListInput(
  state: SpoolListState,
  input: string,
  key: Key,
  count: number,
  rows: number = ROWS,
): SpoolListAction {
  const next = (changes: Partial<SpoolListState>): SpoolListAction => ({
    type: "update",
    state: { ...state, ...changes },
  });
  if (key.escape) return state.filter ? next({ filter: "", cursor: 0 }) : { type: "back" };
  if (key.return)
    return count > 0
      ? { type: "choose", index: Math.min(state.cursor, count - 1) }
      : { type: "none" };
  if (key.tab)
    return next({
      sort:
        INVENTORY_SORTS[(INVENTORY_SORTS.indexOf(state.sort) + 1) % INVENTORY_SORTS.length] ??
        state.sort,
      cursor: 0,
    });
  const moved = listMove(state.cursor, key, count, rows);
  if (moved !== null) return next({ cursor: moved });
  if (key.backspace || key.delete) return next({ filter: state.filter.slice(0, -1), cursor: 0 });
  if (input && !key.ctrl && !key.meta) return next({ filter: state.filter + input, cursor: 0 });
  return { type: "none" };
}

/** One cell per tenth of the label weight left, rounded; "" when unknown. */
export function fillBar(fraction: number | null): string {
  if (fraction === null) return "";
  const full = Math.round(Math.max(0, Math.min(1, fraction)) * BAR_CELLS);
  return "█".repeat(full) + "░".repeat(BAR_CELLS - full);
}

function barColor(fraction: number | null): string | undefined {
  if (fraction === null) return undefined;
  return fraction < 0.1 ? "red" : fraction < 0.25 ? "yellow" : "green";
}

function addedDate(seconds: number | null): string {
  if (!seconds) return "";
  const date = new Date(seconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A column cell, cut to its width; only a `shrink` cell gives up width when the terminal is narrow. */
function Cell({
  width,
  children,
  color,
  dim,
  shrink,
}: {
  width: number;
  children: string;
  color?: string;
  dim?: boolean;
  shrink?: boolean;
}) {
  return (
    <Box width={width} flexShrink={shrink ? 1 : 0} paddingRight={1}>
      <Text wrap="truncate-end" color={color} dimColor={dim}>
        {children}
      </Text>
    </Box>
  );
}

interface Props {
  /** The spools matching the filter, in order. */
  rows: InventoryRow[];
  /** Spools on the console, matching or not. */
  total: number;
  state: SpoolListState;
  /** The terminal's height in rows, when known. */
  height?: number;
}

export function SpoolList({ rows, total, state, height }: Props) {
  const [start, end] = visibleRange(state.cursor, rows.length, spoolListRows(height));
  return (
    <Box flexDirection="column">
      <Text bold>
        Your spools on the console: {state.filter ? `${rows.length} of ${total}` : total} ·{" "}
        {SORT_LABELS[state.sort]}
      </Text>
      <Box marginY={1}>
        <Text>Filter: </Text>
        <Text color="cyan">{state.filter}</Text>
        <Text inverse> </Text>
      </Box>
      <Box>
        <Box width={COLUMNS.cursor + COLUMNS.swatch} flexShrink={0} />
        <Cell width={COLUMNS.id} dim>
          ID
        </Cell>
        <Cell width={COLUMNS.name} dim shrink>
          Filament
        </Cell>
        <Cell width={COLUMNS.left} dim>
          Left
        </Cell>
        <Cell width={COLUMNS.bar} dim>
          {""}
        </Cell>
        <Cell width={COLUMNS.location} dim>
          Location
        </Cell>
        <Cell width={COLUMNS.added} dim>
          Added
        </Cell>
      </Box>
      {rows.slice(start, end).map((row, offset) => {
        const active = start + offset === state.cursor;
        const swatch = row.spool.colorCodes[0];
        return (
          <Box key={row.spool.id}>
            <Cell width={COLUMNS.cursor}>{active ? "›" : ""}</Cell>
            <Box width={COLUMNS.swatch} flexShrink={0}>
              <Text
                backgroundColor={
                  swatch && /^[0-9A-F]{6}/i.test(swatch) ? `#${swatch.slice(0, 6)}` : undefined
                }
              >
                {"  "}
              </Text>
            </Box>
            <Cell width={COLUMNS.id} dim>{`#${row.spool.id}`}</Cell>
            <Cell width={COLUMNS.name} color={active ? "cyan" : undefined} shrink>
              {row.name}
            </Cell>
            <Cell width={COLUMNS.left}>{row.left === null ? "–" : `${row.left} g`}</Cell>
            <Cell width={COLUMNS.bar} color={barColor(row.fraction)}>
              {fillBar(row.fraction)}
            </Cell>
            <Cell width={COLUMNS.location}>{row.spool.location}</Cell>
            <Cell width={COLUMNS.added} dim>
              {addedDate(row.spool.addedTime)}
            </Cell>
          </Box>
        );
      })}
      {rows.length === 0 ? <Text dimColor>No spool matches every word of the filter.</Text> : null}
      {rows.length > end ? <Text dimColor>… {rows.length - end} more</Text> : null}
      <Text dimColor>
        type to filter · tab sort · enter print or add more · esc{" "}
        {state.filter ? "clear filter" : "menu"} · ? help
      </Text>
    </Box>
  );
}
