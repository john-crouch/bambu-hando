// ABOUTME: Shared TUI choice list: pick one item, or tick several (a checklist), with type-ahead and esc to cancel.
// ABOUTME: Key handling is a pure function so App's always-on useInput can drive it without a listener of its own.

import { Box, type Key, Text } from "ink";

import { listMove, type Typed, typeAheadJump, typedLetter } from "./menu.js";
import { visibleRange } from "./Picker.js";
import { listRows } from "./screenSize.js";

const ROWS = 16;
// Title, the list's top and bottom margins, "… more", an error and the hint line, plus a spare line.
const CHROME = 7;

/** Items on screen at once in a terminal `height` rows tall. */
export function choiceRows(height?: number): number {
  return listRows(height, CHROME, ROWS);
}
const LABEL_WIDTH = 40;

export interface ChoiceItem {
  /** What choosing the item sets. */
  value: string;
  /** What the list shows and type-ahead matches. */
  label: string;
  detail?: string;
  /** "#RRGGBB" drawn as a color swatch before the label. */
  swatch?: string;
}

export interface ChoiceState {
  cursor: number;
  /** Ticked values; for a one-choice list, the current value. */
  ticked: ReadonlySet<string>;
  typed?: Typed;
  error: string;
}

export type ChoiceAction = { type: "update"; state: ChoiceState } | { type: "done"; values: string[] } | { type: "cancel" } | { type: "none" };

/** The current values ticked, with the cursor on the first of them. */
export function initialChoiceState(items: ChoiceItem[], current: string[]): ChoiceState {
  const cursor = items.findIndex((item) => current.includes(item.value));
  return { cursor: Math.max(0, cursor), ticked: new Set(current), error: "" };
}

export function choiceInput(state: ChoiceState, input: string, key: Key, items: ChoiceItem[], multi: boolean, now: number = Date.now(), rows: number = ROWS): ChoiceAction {
  const next = (changes: Partial<ChoiceState>): ChoiceAction => ({ type: "update", state: { ...state, error: "", ...changes } });
  if (key.escape) return { type: "cancel" };
  if (key.return) {
    if (!multi) {
      const item = items[state.cursor];
      return item ? { type: "done", values: [item.value] } : { type: "none" };
    }
    const values = items.filter((item) => state.ticked.has(item.value)).map((item) => item.value);
    return values.length > 0 ? { type: "done", values } : next({ error: "Tick at least one with space" });
  }
  if (multi && input === " " && !key.ctrl && !key.meta) {
    const item = items[state.cursor];
    if (!item) return { type: "none" };
    const ticked = new Set(state.ticked);
    if (!ticked.delete(item.value)) ticked.add(item.value);
    return next({ ticked });
  }
  const moved = listMove(state.cursor, key, items.length, rows);
  if (moved !== null) return next({ cursor: moved });
  const letter = typedLetter(input, key);
  if (letter) return next(typeAheadJump(items.map((i) => i.label), state.cursor, letter, state.typed, now));
  return { type: "none" };
}

interface Props {
  title: string;
  items: ChoiceItem[];
  state: ChoiceState;
  multi: boolean;
  /** The terminal's height in rows, when known. */
  height?: number;
}

export function ChoiceList({ title, items, state, multi, height }: Props) {
  const [start, end] = visibleRange(state.cursor, items.length, choiceRows(height));
  const swatches = items.some((item) => item.swatch);
  return (
    <Box flexDirection="column">
      <Text bold>{title}</Text>
      <Box flexDirection="column" marginY={1}>
        {items.slice(start, end).map((item, offset) => {
          const active = start + offset === state.cursor;
          const on = state.ticked.has(item.value);
          return (
            <Box key={item.value}>
              <Box width={2}>
                <Text>{active ? "›" : ""}</Text>
              </Box>
              <Box width={4}>
                <Text>{multi ? (on ? "[x]" : "[ ]") : on ? "(*)" : "( )"}</Text>
              </Box>
              {swatches ? (
                <Box width={3}>
                  <Text backgroundColor={item.swatch}>{item.swatch ? "  " : ""}</Text>
                </Box>
              ) : null}
              <Box width={LABEL_WIDTH} paddingRight={1}>
                <Text wrap="truncate-end" color={active ? "cyan" : undefined}>
                  {item.label}
                </Text>
              </Box>
              <Text dimColor>{item.detail ?? ""}</Text>
            </Box>
          );
        })}
        {items.length > end ? <Text dimColor>… {items.length - end} more</Text> : null}
      </Box>
      {state.error ? <Text color="red">{state.error}</Text> : null}
      <Text dimColor>
        {multi ? "↑/↓ move · space tick · enter done · esc cancel · ? help" : "↑/↓ move · enter choose · esc cancel · ? help"}
      </Text>
    </Box>
  );
}
