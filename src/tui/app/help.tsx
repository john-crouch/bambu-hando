// ABOUTME: The help overlay (?): what the active tab is for, its keys, and the keys that work everywhere.
// ABOUTME: helpLines lays the page out for a width (pure); ↑↓ pgup pgdn home end scroll it, any other key closes it.

import { Box } from "ink";

import type { KeyPress } from "../core/keys.js";
import type { Ctx, Hint, TabId } from "../core/types.js";
import {
  COLORS,
  Dialog,
  dialogInner,
  dialogRows,
  dialogWidth,
  fitText,
  Line,
  type Segment,
  textWidth,
} from "../ui/index.js";
import { spaces, wrapText } from "../ui/text.js";
import { closeThen, type ShellOverlay } from "./messages.js";

/** One paragraph per tab: what it is for. */
export const TAB_ABOUT: Record<TabId, string> = {
  spools:
    "Your spools on the SpoolEase console: what's left of each, what's running low and where it is. Print labels for the ticked spools, add more spools like one you have, or scan a barcode to add the spool it belongs to.",
  add: "Add filaments from SpoolmanDB or a file: pick brand, material and color, see what would be written, then write the BambuStudio presets, SpoolEase's custom filaments and the new spools in one go. Spools you keep on 3DFilamentProfiles are a source too: importing one writes the same and links the two.",
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
  { keys: "q", label: "quit (asks first with unsaved changes; exits 1 if a run failed)" },
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
  /** A key's meaning carried on to the next line, under the meaning's column. */
  | { kind: "label"; text: string; keyWidth: number }
  | { kind: "blank" };

/** text broken into lines of at most width columns, at spaces. */
export const wrap = wrapText;

/** The help page for a width, line by line. */
export function helpLines(request: HelpRequest, width: number): HelpLine[] {
  const keyWidth =
    Math.max(...[...request.hints, ...GLOBAL_HELP].map((h) => textWidth(h.keys))) + 2;
  // Meanings wrap under their own column, never cut.
  const keys = (hints: Hint[]): HelpLine[] =>
    hints.flatMap((h): HelpLine[] => {
      const [first = "", ...rest] = wrap(h.label, Math.max(1, width - keyWidth));
      return [
        { kind: "key", keys: h.keys, label: first, keyWidth },
        ...rest.map((text): HelpLine => ({ kind: "label", text, keyWidth })),
      ];
    });
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
  // The dialog's borders and padding take 4 rows, the halo round it 2.
  return {
    width: dialogWidth(ctx.bodyColumns, 76),
    rows: Math.max(3, dialogRows(ctx.bodyRows) - 4),
  };
}

function maxScroll(model: HelpModel, ctx: Ctx): number {
  const { width, rows } = helpSize(ctx);
  return Math.max(0, helpLines(model.request, dialogInner(width)).length - rows);
}

/** Which way the page goes on, for the bottom border: "↓ more", "↑↓ more", "↑ more", or "" when it all shows. */
export function helpNote(model: HelpModel, ctx: Ctx): string {
  const max = maxScroll(model, ctx);
  if (max === 0) return "";
  const scroll = Math.min(model.scroll, max);
  if (scroll === 0) return "↓ more";
  return scroll >= max ? "↑ more" : "↑↓ more";
}

function helpHints(model: HelpModel, ctx: Ctx): Hint[] {
  const scrolls = maxScroll(model, ctx) > 0;
  return [
    ...(scrolls ? [{ keys: "↑↓", label: "scroll", primary: true }] : []),
    { keys: "any key", label: "close", primary: true },
  ];
}

/** One help line as segments. */
export function helpSegments(line: HelpLine): Segment[] {
  if (line.kind === "blank") return [];
  if (line.kind === "heading") return [{ text: line.text, color: COLORS.accent, bold: true }];
  if (line.kind === "text") return [{ text: line.text }];
  if (line.kind === "label")
    return [{ text: spaces(line.keyWidth) }, { text: line.text, color: COLORS.muted }];
  return [
    { text: fitText(line.keys, line.keyWidth), color: COLORS.accent2, bold: true },
    { text: line.label, color: COLORS.muted },
  ];
}

function HelpView({ model, ctx }: { model: HelpModel; ctx: Ctx }) {
  const { width, rows } = helpSize(ctx);
  const inner = dialogInner(width);
  const lines = helpLines(model.request, inner);
  const scroll = Math.min(model.scroll, maxScroll(model, ctx));
  const shown = lines.slice(scroll, scroll + rows);
  const note = helpNote(model, ctx);
  return (
    <Dialog title={`Help · ${model.request.title}`} width={width} {...(note ? { note } : {})}>
      <Box flexDirection="column">
        {shown.map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a window over fixed lines.
          <Line key={scroll + index} segments={helpSegments(line)} width={inner} />
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
