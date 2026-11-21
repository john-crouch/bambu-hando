// ABOUTME: The help overlay (?): what the active tab is for, its keys, and the keys that work everywhere.
// ABOUTME: helpLines lays the page out for a width (pure); ↑↓ pgup pgdn home end scroll it and any other key closes it.

import { Box, Text } from "ink";
import stringWidth from "string-width";

import type { KeyPress } from "../core/keys.js";
import type { Ctx, Hint, TabId } from "../core/types.js";
import { closeThen, type ShellOverlay } from "./messages.js";
import { COLORS, Dialog } from "./stub-ui.js";

/** One paragraph per tab: what it is for. */
export const TAB_ABOUT: Record<TabId, string> = {
  spools:
    "Your spools on the SpoolEase console: what's left of each, what's running low and where it is. Print labels for the ticked spools, add more spools like one you have, or scan a barcode to add the spool it belongs to.",
  add: "Add filaments from SpoolmanDB or a file: pick brand, material and color, see what would be written, then write the BambuStudio presets, SpoolEase's custom filaments and the new spools in one go.",
  presets:
    "Your own BambuStudio filament presets, grouped by filament ID. Open one to change its settings; you see every change, and every preset it saves to, before anything is written.",
  check:
    "Whether BambuStudio and SpoolEase agree: presets the console doesn't know, codes without a preset, spools whose filament is missing, each with how to fix it. Nothing changes until you ask.",
  settings:
    "Where presets go and for which printers, how to reach the SpoolEase console, how labels print and where filaments are imported from. Changes apply to this session right away.",
};

/** Keys the shell handles itself, shown under every tab's own. */
export const GLOBAL_HELP: Hint[] = [
  { keys: "tab", label: "next tab" },
  { keys: "shift+tab", label: "previous tab" },
  { keys: "ctrl+k", label: "find a command by name" },
  { keys: "?", label: "this help" },
  { keys: "esc", label: "back: close, clear a filter, up a level" },
  { keys: "q", label: "quit (exits 1 if a run failed)" },
  { keys: "ctrl+c", label: "quit right away, from anywhere" },
];

export interface HelpRequest {
  tab: TabId;
  title: string;
  /** The active tab's keys right now. */
  hints: Hint[];
  /** The tab is taking text, so q and ? type there. */
  typing: boolean;
}

export interface HelpModel {
  request: HelpRequest;
  scroll: number;
}

export type HelpLine =
  | { kind: "heading"; text: string }
  | { kind: "text"; text: string }
  | { kind: "key"; keys: string; label: string; keyWidth: number }
  | { kind: "blank" };

/** text broken into lines of at most width columns, at spaces. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && stringWidth(next) > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** The help page for a width, line by line. */
export function helpLines(request: HelpRequest, width: number): HelpLine[] {
  const keyWidth =
    Math.max(...[...request.hints, ...GLOBAL_HELP].map((h) => stringWidth(h.keys))) + 2;
  const keys = (hints: Hint[]): HelpLine[] =>
    hints.map((h) => ({ kind: "key", keys: h.keys, label: h.label, keyWidth }));
  const lines: HelpLine[] = [
    ...wrap(TAB_ABOUT[request.tab], width).map((text): HelpLine => ({ kind: "text", text })),
    { kind: "blank" },
    { kind: "heading", text: `In ${request.title}` },
    ...(request.hints.length > 0
      ? keys(request.hints)
      : [{ kind: "text", text: "Only the keys below." } as HelpLine]),
    { kind: "blank" },
    { kind: "heading", text: "Everywhere" },
    ...keys(GLOBAL_HELP),
  ];
  if (request.typing)
    lines.push(
      { kind: "blank" },
      ...wrap("A text field has focus: letters, q and ? type there; esc leaves it.", width).map(
        (text): HelpLine => ({ kind: "text", text }),
      ),
    );
  return lines;
}

/** Dialog width and the page's visible height. */
export function helpSize(ctx: Ctx): { width: number; rows: number } {
  // Border, title and its gap, the hint line and its gap: 6.
  return {
    width: Math.max(30, Math.min(76, ctx.columns - 4)),
    rows: Math.max(3, ctx.bodyRows - 6),
  };
}

function maxScroll(model: HelpModel, ctx: Ctx): number {
  const { width, rows } = helpSize(ctx);
  return Math.max(0, helpLines(model.request, width - 4).length - rows);
}

function helpHints(model: HelpModel, ctx: Ctx): Hint[] {
  const scrolls = maxScroll(model, ctx) > 0;
  return [
    ...(scrolls ? [{ keys: "↑↓", label: "scroll", primary: true }] : []),
    { keys: "any key", label: "close", primary: true },
  ];
}

function HelpRow({ line }: { line: HelpLine }) {
  if (line.kind === "blank") return <Text> </Text>;
  if (line.kind === "heading")
    return (
      <Text bold color={COLORS.accent}>
        {line.text}
      </Text>
    );
  if (line.kind === "text") return <Text>{line.text}</Text>;
  return (
    <Box>
      <Box width={line.keyWidth} flexShrink={0}>
        <Text color={COLORS.accent2}>{line.keys}</Text>
      </Box>
      <Text dimColor wrap="truncate-end">
        {line.label}
      </Text>
    </Box>
  );
}

function HelpView({ model, ctx }: { model: HelpModel; ctx: Ctx }) {
  const { width, rows } = helpSize(ctx);
  const lines = helpLines(model.request, width - 4);
  const scroll = Math.min(model.scroll, maxScroll(model, ctx));
  const shown = lines.slice(scroll, scroll + rows);
  const more = lines.length > rows ? ` · ${scroll + shown.length}/${lines.length}` : "";
  return (
    <Dialog
      title={`Help · ${model.request.title}${more}`}
      width={width}
      hints={helpHints(model, ctx)}
    >
      <Box flexDirection="column">
        {shown.map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a window over fixed lines.
          <HelpRow key={scroll + index} line={line} />
        ))}
      </Box>
    </Dialog>
  );
}

export const HELP: ShellOverlay<HelpModel, HelpRequest> = {
  init: (request) => [{ request, scroll: 0 }, []],
  update(model, msg, ctx) {
    if (msg.type === "resize")
      return [{ ...model, scroll: Math.min(model.scroll, maxScroll(model, ctx)) }, []];
    if (msg.type !== "key") return [model, []];
    const key = msg.key as KeyPress;
    const { rows } = helpSize(ctx);
    const max = maxScroll(model, ctx);
    const to = (scroll: number) =>
      [{ ...model, scroll: Math.max(0, Math.min(scroll, max)) }, []] as [HelpModel, []];
    if (key.name === "up") return to(model.scroll - 1);
    if (key.name === "down") return to(model.scroll + 1);
    if (key.name === "pageUp") return to(model.scroll - rows);
    if (key.name === "pageDown") return to(model.scroll + rows);
    if (key.name === "home") return to(0);
    if (key.name === "end") return to(max);
    return [model, [closeThen()]];
  },
  View: HelpView,
  hints: helpHints,
};
