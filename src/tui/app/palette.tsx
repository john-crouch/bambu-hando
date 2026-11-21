// ABOUTME: The command palette (ctrl+k): a fuzzy filter over every tab's commands and the shell's own; enter runs one.
// ABOUTME: fuzzyMatch and paletteInput are pure; the view only draws the query line and the ranked list.

import { Box, Text } from "ink";
import stringWidth from "string-width";

import { isCtrl, type KeyPress, typed } from "../core/keys.js";
import type { AppMsg, Ctx, Hint, TabMsg } from "../core/types.js";
import { closeThen, type PaletteItem, type ShellMsg, type ShellOverlay } from "./messages.js";
import { COLORS, Dialog } from "./stub-ui.js";

export interface PaletteModel {
  items: PaletteItem[];
  query: string;
  cursor: number;
}

export interface Match {
  score: number;
  /** Indexes into the text of the matched characters, for highlighting. */
  hits: number[];
}

const WORD_START = /[\s\-_/.·:(]/;

function isSubsequence(needle: string, haystack: string, from: number): boolean {
  let at = from;
  for (const char of needle) {
    at = haystack.indexOf(char, at);
    if (at === -1) return false;
    at += 1;
  }
  return true;
}

/**
 * The query's characters (spaces ignored) in order in text, case-insensitive; null when they aren't.
 * Higher scores for matches at word starts, in runs, and early.
 */
export function fuzzyMatch(query: string, text: string): Match | null {
  const needle = query.toLowerCase().replace(/\s+/g, "");
  if (!needle) return { score: 0, hits: [] };
  const haystack = text.toLowerCase();
  const hits: number[] = [];
  let score = 0;
  let from = 0;
  for (let n = 0; n < needle.length; n++) {
    const char = needle[n] as string;
    const rest = needle.slice(n + 1);
    // Prefer this character at a word start (if the rest still fits after it), else its next occurrence.
    let at = -1;
    for (let i = from; i < haystack.length; i++) {
      if (haystack[i] !== char) continue;
      if (at === -1) at = i;
      if (
        (i === 0 || WORD_START.test(haystack[i - 1] as string)) &&
        isSubsequence(rest, haystack, i + 1)
      ) {
        at = i;
        break;
      }
    }
    if (at === -1) return null;
    const previous = hits[hits.length - 1];
    if (previous !== undefined && at === previous + 1) score += 5;
    if (at === 0 || WORD_START.test(haystack[at - 1] as string)) score += 8;
    score -= Math.min(at - from, 10) * 0.5;
    hits.push(at);
    from = at + 1;
  }
  return { score: score - text.length * 0.05, hits };
}

/** The items the query keeps, best first; ties keep the palette's order. */
export function paletteRows(model: PaletteModel): { item: PaletteItem; hits: number[] }[] {
  const ranked = model.items
    .map((item, index) => ({ item, index, match: fuzzyMatch(model.query, item.title) }))
    .filter((row): row is typeof row & { match: Match } => row.match !== null);
  if (model.query.trim()) ranked.sort((a, b) => b.match.score - a.match.score || a.index - b.index);
  return ranked.map((row) => ({ item: row.item, hits: row.match.hits }));
}

export type PaletteAction =
  | { type: "update"; model: PaletteModel }
  | { type: "run"; item: PaletteItem }
  | { type: "close" }
  | { type: "none" };

/** What a key does in the palette: type, move, run the highlighted command or close. */
export function paletteInput(model: PaletteModel, key: KeyPress, pageRows: number): PaletteAction {
  const rows = paletteRows(model);
  const last = rows.length - 1;
  const move = (cursor: number): PaletteAction => ({
    type: "update",
    model: { ...model, cursor: Math.max(0, Math.min(cursor, last)) },
  });
  if (key.name === "esc" || isCtrl(key, "k")) return { type: "close" };
  if (key.name === "enter") {
    const row = rows[model.cursor];
    return row ? { type: "run", item: row.item } : { type: "none" };
  }
  if (key.name === "up" || isCtrl(key, "p")) return move(model.cursor - 1);
  if (key.name === "down" || isCtrl(key, "n")) return move(model.cursor + 1);
  if (key.name === "pageUp") return move(model.cursor - pageRows);
  if (key.name === "pageDown") return move(model.cursor + pageRows);
  if (key.name === "home") return move(0);
  if (key.name === "end") return move(last);
  if (key.name === "backspace" || key.name === "delete")
    return { type: "update", model: { ...model, query: model.query.slice(0, -1), cursor: 0 } };
  if (isCtrl(key, "u")) return { type: "update", model: { ...model, query: "", cursor: 0 } };
  const text = typed(key).replace(/[\r\n]+/g, " ");
  if (text) return { type: "update", model: { ...model, query: model.query + text, cursor: 0 } };
  return { type: "none" };
}

/** Dialog width and list height from the terminal. */
export function paletteSize(ctx: Ctx): { width: number; rows: number } {
  return {
    width: Math.max(30, Math.min(72, ctx.columns - 4)),
    // Border, title, its gap, the query line and its gap, the hint line and its gap: 8.
    rows: Math.max(3, Math.min(12, ctx.bodyRows - 8)),
  };
}

/** The first row to show so the cursor stays in view. */
function windowStart(cursor: number, count: number, height: number): number {
  if (count <= height) return 0;
  return Math.max(0, Math.min(cursor - Math.floor(height / 2), count - height));
}

function Highlighted({
  text,
  hits,
  selected,
}: {
  text: string;
  hits: number[];
  selected: boolean;
}) {
  const marked = new Set(hits);
  return (
    <Text>
      {[...text].map((char, index) =>
        marked.has(index) ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: characters of a fixed string.
          <Text key={index} color={selected ? COLORS.accent2 : COLORS.accent} bold>
            {char}
          </Text>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: characters of a fixed string.
          <Text key={index}>{char}</Text>
        ),
      )}
    </Text>
  );
}

const HINTS: Hint[] = [
  { keys: "↑↓", label: "move", primary: true },
  { keys: "enter", label: "run", primary: true },
  { keys: "esc", label: "close", primary: true },
];

function PaletteView({ model, ctx }: { model: PaletteModel; ctx: Ctx }) {
  const { width, rows: height } = paletteSize(ctx);
  const inner = width - 4;
  const rows = paletteRows(model);
  const top = windowStart(model.cursor, rows.length, height);
  const shown = rows.slice(top, top + height);
  const count = `${rows.length}/${model.items.length}`;
  return (
    <Dialog title="Commands" width={width} hints={HINTS}>
      <Box>
        <Text color={COLORS.accent}>› </Text>
        <Box flexGrow={1}>
          {model.query ? (
            <Text>
              {model.query}
              <Text inverse> </Text>
            </Text>
          ) : (
            <Text>
              <Text inverse> </Text>
              <Text dimColor>Type to find a command</Text>
            </Text>
          )}
        </Box>
        <Text dimColor>{count}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1} height={height}>
        {shown.length === 0 ? (
          <Text dimColor>No command matches "{model.query}"</Text>
        ) : (
          shown.map((row, index) => {
            const selected = top + index === model.cursor;
            const detail = row.item.detail ?? "";
            const titleRoom = inner - 2 - (detail ? stringWidth(detail) + 2 : 0);
            return (
              <Box
                key={`${row.item.detail ?? ""}:${row.item.title}`}
                width={inner}
                backgroundColor={selected ? COLORS.selection : undefined}
              >
                <Box width={2} flexShrink={0}>
                  <Text color={COLORS.accent}>{selected ? "▌" : " "}</Text>
                </Box>
                <Box width={Math.max(1, titleRoom)} flexShrink={0}>
                  <Text wrap="truncate-end" {...(selected ? { color: COLORS.selectionText } : {})}>
                    <Highlighted text={row.item.title} hits={row.hits} selected={selected} />
                  </Text>
                </Box>
                {detail ? (
                  <Box flexGrow={1} justifyContent="flex-end">
                    <Text dimColor>{detail}</Text>
                  </Box>
                ) : null}
              </Box>
            );
          })
        )}
      </Box>
    </Dialog>
  );
}

export const PALETTE: ShellOverlay<PaletteModel, PaletteItem[]> = {
  init: (items) => [{ items, query: "", cursor: 0 }, []],
  update(model, msg: AppMsg | TabMsg, ctx) {
    if (msg.type === "paste") {
      const text = String(msg.text).replace(/[\r\n]+/g, " ");
      return [{ ...model, query: model.query + text, cursor: 0 }, []];
    }
    if (msg.type !== "key") return [model, []];
    const action = paletteInput(model, msg.key as KeyPress, paletteSize(ctx).rows);
    if (action.type === "update") return [action.model, []];
    if (action.type === "close") return [model, [closeThen()]];
    if (action.type === "run") {
      const first: ShellMsg[] = action.item.tab
        ? [{ type: "app/switchTab", tab: action.item.tab }]
        : [];
      return [model, [closeThen(...first, action.item.msg)]];
    }
    return [model, []];
  },
  View: PaletteView,
  hints: () => HINTS,
};
