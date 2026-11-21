// ABOUTME: The command palette (ctrl+k): a fuzzy filter over every tab's commands and the shell's own; enter runs one.
// ABOUTME: fuzzyMatch and paletteInput are pure; the view only draws the query line and the ranked list.

import { Box } from "ink";

import { isCtrl, type KeyPress, typed } from "../core/keys.js";
import type { AppMsg, Ctx, Hint, TabMsg } from "../core/types.js";
import {
  COLORS,
  Dialog,
  dialogInner,
  dialogWidth,
  Line,
  listWindow,
  type Segment,
  textWidth,
} from "../ui/index.js";
import { padSegments } from "../ui/text.js";
import { closeThen, type PaletteItem, type ShellMsg, type ShellOverlay } from "./messages.js";

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
export function paletteSize(ctx: Ctx, items: number): { width: number; rows: number } {
  return {
    width: dialogWidth(ctx.bodyColumns, 72),
    // As tall as every command (so it doesn't jump while typing), within the body. The dialog's
    // borders and padding take 4, the query line and its gap 2.
    rows: Math.max(3, Math.min(12, items, ctx.bodyRows - 6)),
  };
}

/** A title as segments, the matched characters in accent (accent 2 on the selection bar). */
export function titleSegments(text: string, hits: readonly number[], selected: boolean): Segment[] {
  const marked = new Set(hits);
  const base: Omit<Segment, "text"> = selected ? { color: COLORS.selectionText } : {};
  const out: Segment[] = [];
  [...text].forEach((char, index) => {
    const style: Omit<Segment, "text"> = marked.has(index)
      ? { color: selected ? COLORS.accent2 : COLORS.accent, bold: true }
      : base;
    const last = out[out.length - 1];
    if (last && last.color === style.color && last.bold === style.bold) last.text += char;
    else out.push({ ...style, text: char });
  });
  return out;
}

/** One palette row of exactly width columns: gutter mark, title (cut with …), detail at the right. */
export function rowSegments(
  item: PaletteItem,
  hits: readonly number[],
  selected: boolean,
  width: number,
): Segment[] {
  const fill: Omit<Segment, "text"> = selected ? { backgroundColor: COLORS.selection } : {};
  const paint = (segments: Segment[]): Segment[] => segments.map((seg) => ({ ...fill, ...seg }));
  const detail = item.detail ?? "";
  const detailWidth = detail ? textWidth(detail) + 1 : 0;
  const titleWidth = Math.max(1, width - 2 - detailWidth);
  return paint([
    { text: selected ? "▌ " : "  ", color: COLORS.accent },
    ...padSegments(titleSegments(item.title, hits, selected), titleWidth, fill),
    ...(detail ? [{ text: ` ${detail}`, color: COLORS.muted }] : []),
  ]);
}

/** The query line: prompt, query and cursor (or the placeholder), and the match count at the right. */
export function queryLine(model: PaletteModel, matches: number, width: number): Segment[] {
  const count = `${matches}/${model.items.length}`;
  const left: Segment[] = [
    { text: "› ", color: COLORS.accent, bold: true },
    ...(model.query ? [{ text: model.query }] : []),
    { text: " ", inverse: true },
    ...(model.query ? [] : [{ text: " Type to find a command", color: COLORS.muted }]),
  ];
  const room = Math.max(0, width - textWidth(count) - 1);
  return [...padSegments(left, room), { text: " " }, { text: count, color: COLORS.muted }];
}

const HINTS: Hint[] = [
  { keys: "↑↓", label: "move", primary: true },
  { keys: "enter", label: "run", primary: true },
  { keys: "esc", label: "close", primary: true },
];

function PaletteView({ model, ctx }: { model: PaletteModel; ctx: Ctx }) {
  const { width, rows: height } = paletteSize(ctx, model.items.length);
  const inner = dialogInner(width);
  const rows = paletteRows(model);
  const { start, end } = listWindow(model.cursor, rows.length, height);
  const shown = rows.slice(start, end);
  return (
    <Dialog title="Commands" width={width}>
      <Line segments={queryLine(model, rows.length, inner)} width={inner} />
      <Box flexDirection="column" marginTop={1} height={height}>
        {shown.length === 0 ? (
          <Line
            segments={[{ text: `No command matches "${model.query}"`, color: COLORS.muted }]}
            width={inner}
          />
        ) : (
          shown.map((row, index) => (
            <Line
              key={`${row.item.detail ?? ""}:${row.item.title}`}
              segments={rowSegments(row.item, row.hits, start + index === model.cursor, inner)}
              width={inner}
            />
          ))
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
    const action = paletteInput(
      model,
      msg.key as KeyPress,
      paletteSize(ctx, model.items.length).rows,
    );
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
