// ABOUTME: SpoolmanDB browser: brand → material → color lists with counts; space selects colors, enter continues.
// ABOUTME: Key handling is a pure function so App's always-on useInput can drive it without a listener of its own.

import { Box, type Key, Text } from "ink";

import type { FilamentProfile } from "../models.js";
import { listMove, type Typed, typeAheadJump, typedLetter } from "./menu.js";
import { visibleRange } from "./Picker.js";
import { listRows } from "./screenSize.js";

const ROWS = 14;
// Title, the level line with its margins, "… more" and the hint line, plus a spare line; warnings come on top.
const CHROME = 7;

/** Rows on screen at once in a terminal `height` rows tall, below `warnings` warning lines. */
export function browseListRows(height: number | undefined, warnings: number): number {
  return listRows(height, CHROME + warnings, ROWS);
}
const COLUMNS = { cursor: 2, mark: 4, swatch: 3, label: 40, count: 7, temps: 10, code: 10 } as const;

export interface BrowseState {
  /** null on the brand list. */
  brand: string | null;
  /** null on the brand and material lists. */
  material: string | null;
  cursor: number;
  /** Where the cursor was on the brand and material lists, restored when going back up. */
  brandCursor: number;
  materialCursor: number;
  /** Letters typed for type-ahead, and when. */
  typed?: Typed;
}

export type BrowseRow =
  | { kind: "search"; label: string }
  | { kind: "brand"; label: string; count: number; selected: number }
  | { kind: "material"; label: string; count: number; selected: number }
  | { kind: "product"; label: string; profile: FilamentProfile }
  /** Last on every color list: a color the catalog doesn't list. */
  | { kind: "other"; label: string };

export type BrowseAction =
  | { type: "update"; state: BrowseState; selected?: ReadonlySet<string> }
  | { type: "search" }
  /** Open the form for a color of the current brand and material that isn't listed. */
  | { type: "other" }
  | { type: "back" }
  | { type: "done"; selected: ReadonlySet<string> }
  | { type: "none" };

export function initialBrowseState(): BrowseState {
  return { brand: null, material: null, cursor: 0, brandCursor: 0, materialCursor: 0 };
}

const byName = (a: string, b: string): number => a.localeCompare(b, undefined, { sensitivity: "base" });

function productLabel(profile: FilamentProfile): string {
  return profile.colorName || profile.name;
}

/** Distinct values of `pick`, sorted, with how many profiles and selected profiles have each. */
function groups(profiles: FilamentProfile[], pick: (p: FilamentProfile) => string, selected: ReadonlySet<string>) {
  const counts = new Map<string, { count: number; selected: number }>();
  for (const p of profiles) {
    const entry = counts.get(pick(p)) ?? { count: 0, selected: 0 };
    entry.count += 1;
    if (selected.has(p.filamentId)) entry.selected += 1;
    counts.set(pick(p), entry);
  }
  return [...counts].sort(([a], [b]) => byName(a, b)).map(([label, c]) => ({ label, ...c }));
}

function materialsOf(profiles: FilamentProfile[], brand: string | null): string[] {
  return groups(
    profiles.filter((p) => p.brand === brand),
    (p) => p.material,
    new Set(),
  ).map((g) => g.label);
}

export function browseRows(state: BrowseState, profiles: FilamentProfile[], selected: ReadonlySet<string>): BrowseRow[] {
  if (state.brand === null) {
    return [{ kind: "search", label: "Search by name…" }, ...groups(profiles, (p) => p.brand, selected).map((g) => ({ kind: "brand" as const, ...g }))];
  }
  const ofBrand = profiles.filter((p) => p.brand === state.brand);
  if (state.material === null) return groups(ofBrand, (p) => p.material, selected).map((g) => ({ kind: "material" as const, ...g }));
  const products = ofBrand
    .filter((p) => p.material === state.material)
    .sort((a, b) => byName(productLabel(a), productLabel(b)))
    .map((profile) => ({ kind: "product" as const, label: productLabel(profile), profile }));
  return [...products, { kind: "other", label: "Other color…" }];
}

export function browseInput(
  state: BrowseState,
  input: string,
  key: Key,
  profiles: FilamentProfile[],
  selected: ReadonlySet<string>,
  now: number = Date.now(),
  page: number = ROWS,
): BrowseAction {
  const rows = browseRows(state, profiles, selected);
  const next = (changes: Partial<BrowseState>, nextSelected?: ReadonlySet<string>): BrowseAction => ({
    type: "update",
    state: { ...state, ...changes },
    ...(nextSelected ? { selected: nextSelected } : {}),
  });

  // Each list starts its own type-ahead: letters typed for the brand must not carry into its materials.
  if (key.escape) {
    if (state.material !== null && materialsOf(profiles, state.brand).length > 1) return next({ material: null, cursor: state.materialCursor, typed: undefined });
    if (state.brand !== null) return next({ brand: null, material: null, cursor: state.brandCursor, typed: undefined });
    return { type: "back" };
  }

  const row = rows[state.cursor];
  if (key.return) {
    if (!row) return { type: "none" };
    if (row.kind === "search") return { type: "search" };
    if (row.kind === "brand") {
      const materials = materialsOf(profiles, row.label);
      return next({ brand: row.label, material: materials.length === 1 ? materials[0]! : null, cursor: 0, brandCursor: state.cursor, typed: undefined });
    }
    if (row.kind === "material") return next({ material: row.label, cursor: 0, materialCursor: state.cursor, typed: undefined });
    if (row.kind === "other") return { type: "other" };
    return { type: "done", selected: selected.size > 0 ? selected : new Set([row.profile.filamentId]) };
  }

  if (row?.kind === "product" && input === " " && !key.ctrl && !key.meta) {
    const toggled = new Set(selected);
    if (!toggled.delete(row.profile.filamentId)) toggled.add(row.profile.filamentId);
    return next({ cursor: Math.min(state.cursor + 1, rows.length - 1) }, toggled);
  }
  if (state.material !== null && key.ctrl && input === "a") {
    const ids = rows.flatMap((r) => (r.kind === "product" ? [r.profile.filamentId] : []));
    const toggled = new Set(selected);
    const all = ids.every((id) => toggled.has(id));
    for (const id of ids) {
      if (all) toggled.delete(id);
      else toggled.add(id);
    }
    return next({}, toggled);
  }

  const moved = listMove(state.cursor, key, rows.length, page);
  if (moved !== null) return next({ cursor: moved });
  const letter = typedLetter(input, key);
  if (letter) return next(typeAheadJump(rows.map((r) => r.label), state.cursor, letter, state.typed, now));
  return { type: "none" };
}

function Cell({ width, children, dim, color }: { width: number; children: string; dim?: boolean; color?: string }) {
  return (
    <Box width={width} paddingRight={1}>
      <Text wrap="truncate-end" dimColor={dim} color={color}>
        {children}
      </Text>
    </Box>
  );
}

interface Props {
  state: BrowseState;
  profiles: FilamentProfile[];
  selected: ReadonlySet<string>;
  warnings: string[];
  /** The terminal's height in rows, when known. */
  height?: number;
}

export function Browse({ state, profiles, selected, warnings, height }: Props) {
  const rows = browseRows(state, profiles, selected);
  const [start, end] = visibleRange(state.cursor, rows.length, browseListRows(height, warnings.length));
  const where = state.brand === null ? "Brands" : state.material === null ? state.brand : `${state.brand} / ${state.material}`;
  const up = state.brand === null ? "menu" : state.material !== null && materialsOf(profiles, state.brand).length > 1 ? "materials" : "brands";
  const hint =
    state.material === null
      ? `↑/↓ move · enter open · esc ${up} · ? help`
      : `↑/↓ move · space select · enter continue · esc ${up} · ? help`;

  return (
    <Box flexDirection="column">
      <Text bold>
        SpoolmanDB: {profiles.length} filaments · {selected.size} selected
      </Text>
      {warnings.map((w) => (
        <Text key={w} color="yellow">
          ! {w}
        </Text>
      ))}
      <Box marginY={1}>
        <Text color="cyan">{where}</Text>
      </Box>
      {rows.slice(start, end).map((row, offset) => {
        const active = start + offset === state.cursor;
        const color = active ? "cyan" : undefined;
        return (
          <Box key={`${row.kind}-${row.kind === "product" ? row.profile.filamentId : row.label}`}>
            <Cell width={COLUMNS.cursor}>{active ? "›" : ""}</Cell>
            {row.kind === "product" ? (
              <>
                <Cell width={COLUMNS.mark}>{selected.has(row.profile.filamentId) ? "[x]" : "[ ]"}</Cell>
                <Box width={COLUMNS.swatch}>
                  <Text backgroundColor={`#${row.profile.colorRgba.slice(0, 6)}`}>{"  "}</Text>
                </Box>
                <Cell width={COLUMNS.label} color={color}>
                  {row.label}
                </Cell>
                <Cell width={COLUMNS.temps}>{`${row.profile.nozzleTempMin}-${row.profile.nozzleTempMax}`}</Cell>
                <Cell width={COLUMNS.code} dim>
                  {row.profile.filamentId}
                </Cell>
              </>
            ) : row.kind === "other" ? (
              <>
                <Box width={COLUMNS.mark + COLUMNS.swatch} />
                <Cell width={COLUMNS.label} color={color}>
                  {row.label}
                </Cell>
              </>
            ) : (
              <>
                <Cell width={COLUMNS.label} color={color}>
                  {row.label}
                </Cell>
                {row.kind === "search" ? null : (
                  <>
                    <Cell width={COLUMNS.count} dim>
                      {String(row.count)}
                    </Cell>
                    <Text color="green">{row.selected > 0 ? `${row.selected} selected` : ""}</Text>
                  </>
                )}
              </>
            )}
          </Box>
        );
      })}
      {rows.length > end ? <Text dimColor>… {rows.length - end} more</Text> : null}
      <Text dimColor>{hint}</Text>
    </Box>
  );
}
