// ABOUTME: What the Check tab shows from the sync check: its state, a row per section, the headline and its layout.
// ABOUTME: Pure functions over the shell's check resource and the session's values; the console URL never has the key.

import { type CheckSection, checkCounts, checkSync, type UserPreset } from "../../../syncCheck.js";
import type { CheckData, Ctx } from "../../core/types.js";
import { consoleUrl, panelInner, plural, textWidth } from "../../ui/index.js";
import { CLOSE_BAMBUSTUDIO_FIRST } from "../presets/detail.js";
import { connectionOf, consoleProblem, shortPrinters } from "../settings/connection.js";
import { wrapText } from "../settings/wrap.js";

/** none: no console to check against (SpoolEase skipped or not set up). */
export interface CheckView {
  kind: "none" | "loading" | "ready" | "failed";
  /** The check to show: the current one, or the last good one while reloading or after a failure. */
  data?: CheckData;
  error?: string;
  /**
   * The console couldn't be read and there's no earlier check: data holds only what BambuStudio's presets
   * can tell (presets without an ID), and every other section waits for the console.
   */
  offline?: boolean;
}

export function consoleConfigured(ctx: Ctx): boolean {
  return connectionOf(ctx.values) !== null;
}

/** Sections that need the console's filaments or spools: everything but presets without an ID. */
export function needsConsole(key: CheckSection["key"]): boolean {
  return key !== "presetsNoId";
}

/** The check as far as BambuStudio's presets alone go: the console's sections are empty and marked offline. */
function presetsOnlyCheck(ctx: Ctx): CheckData | undefined {
  const presets = ctx.resources.presets;
  const value =
    presets.state === "ready"
      ? presets.value
      : presets.state !== "idle"
        ? presets.previous
        : undefined;
  if (!value) return undefined;
  const sections = checkSync({ presets: value.presets, csv: "", spools: [] }).map((section) =>
    needsConsole(section.key) ? { ...section, items: [] } : section,
  );
  return { sections, warnings: value.warnings, presets: value.presets };
}

export function checkView(ctx: Ctx): CheckView {
  if (!consoleConfigured(ctx)) return { kind: "none" };
  const check = ctx.resources.check;
  switch (check.state) {
    case "idle":
      return { kind: "loading" };
    case "loading":
      return { kind: "loading", ...(check.previous ? { data: check.previous } : {}) };
    case "ready":
      return { kind: "ready", data: check.value };
    case "failed": {
      if (check.previous) return { kind: "failed", error: check.error, data: check.previous };
      const partial = presetsOnlyCheck(ctx);
      return {
        kind: "failed",
        error: check.error,
        ...(partial ? { data: partial, offline: true } : {}),
      };
    }
  }
}

export interface SectionRow {
  key: CheckSection["key"];
  title: string;
  count: number;
  /**
   * ok: nothing in it; problem: it breaks a spool's link to its preset; note: worth knowing;
   * offline: not checked, the console couldn't be read.
   */
  tone: "ok" | "problem" | "note" | "offline";
}

export function sectionRows(sections: CheckSection[], offline = false): SectionRow[] {
  return sections.map((section) => ({
    key: section.key,
    title: section.title,
    count: section.items.length,
    tone:
      offline && needsConsole(section.key)
        ? "offline"
        : section.items.length === 0
          ? "ok"
          : section.problem
            ? "problem"
            : "note",
  }));
}

/** The first section with something in it, else the first. */
export function firstWithItems(sections: CheckSection[]): number {
  return Math.max(
    0,
    sections.findIndex((section) => section.items.length > 0),
  );
}

/** The section a deep link names, or -1. */
export function sectionIndex(sections: CheckSection[], key: string): number {
  return sections.findIndex((section) => section.key === key);
}

export interface Headline {
  /** "Everything lines up", "No problems · M notes" or "N problems · M notes". */
  text: string;
  /** Notes alone are fine: only problems turn the headline red. */
  tone: "ok" | "problem";
  /** What was compared: "BambuStudio <preset folder> with <the console's URL>". */
  compared: string;
}

export function checkHeadline(sections: CheckSection[], ctx: Ctx): Headline {
  const { problems, notes } = checkCounts(sections);
  const connection = connectionOf(ctx.values);
  const text =
    problems + notes === 0
      ? "Everything lines up"
      : [
          problems ? plural(problems, "problem") : "No problems",
          ...(notes ? [plural(notes, "note")] : []),
        ].join(" · ");
  return {
    text,
    tone: problems > 0 ? "problem" : "ok",
    compared: [
      `BambuStudio ${ctx.values.presetFolder.trim()}`,
      ...(connection ? [consoleUrl(connection)] : []),
    ].join(" with "),
  };
}

/** Where enter on an item goes: the tab and the thing to open there, or the ID review for some presets. */
export type ItemTarget =
  /** name, when known, lets Add search for a filament it can't find by ID. */
  | { kind: "add"; id: string; name?: string }
  | { kind: "spools"; id: string }
  | { kind: "ids"; paths: string[] };

/** An item as the items pane draws it: the name apart from codes and printers, and what fixes it. */
export interface ItemView {
  /** The whole item, as the sync check says it. */
  text: string;
  name: string;
  /** A filament code or ID, dim. */
  code?: string;
  /** Short printers: "X1C 0.4, 0.6". */
  printers?: string;
  /** A spool's ID, without the #. */
  spool?: string;
  /** A preset's files, one per printer. */
  files?: number;
  target: ItemTarget | null;
}

/** What enter does on each kind of target, for the footer. */
export function targetLabel(target: ItemTarget): string {
  if (target.kind === "ids") return "give it an ID";
  if (target.kind === "spools") return "show it in Spools";
  // Add opens on the filament, searches for it by name, or says how to import it: "sync" would promise too much.
  return "find it in Add";
}

/** Add's deep link for a filament: "id:<filament ID>|name:<name>" (the name without "|", left out when empty). */
export function addFocus(target: Extract<ItemTarget, { kind: "add" }>): string {
  const name = target.name?.replaceAll("|", " ").trim();
  return name ? `id:${target.id}|name:${name}` : `id:${target.id}`;
}

/** "name (code)" at the end of an item. */
const WITH_CODE = /^(.*) \(([^()]*)\)$/;
/** "#14 Acme PLA Red", a spool as the check lists it. */
const SPOOL = /^#(\S+) ?(.*)$/;

/**
 * The presets behind the preset items, keyed by the item's text exactly as syncCheck writes it:
 * "<name> (<id>) · <printers>" for presets SpoolEase lacks, "<name> · <printers>" for presets without an ID.
 */
function presetGroups(presets: readonly UserPreset[]): Map<string, UserPreset[]> {
  const byKey = new Map<string, UserPreset[]>();
  for (const preset of presets) {
    const key = preset.filamentId ? `id:${preset.filamentId}` : `name:${preset.name}`;
    byKey.set(key, [...(byKey.get(key) ?? []), preset]);
  }
  const byItem = new Map<string, UserPreset[]>();
  for (const group of byKey.values()) {
    const first = group[0];
    if (!first) continue;
    const printers = group.map((p) => p.printer).join(", ");
    const id = first.filamentId ? ` (${first.filamentId})` : "";
    byItem.set(`${first.name}${id} · ${printers}`, group);
  }
  return byItem;
}

function itemView(
  key: CheckSection["key"],
  text: string,
  groups: Map<string, UserPreset[]>,
): ItemView {
  const plain: ItemView = { text, name: text, target: null };
  switch (key) {
    case "csvOnly": {
      const [, name, code] = WITH_CODE.exec(text) ?? [];
      return name !== undefined && code
        ? { text, name, code, target: { kind: "add", id: code, name } }
        : plain;
    }
    case "unknownCode": {
      const [, rest, code] = WITH_CODE.exec(text) ?? [];
      const [, spool, name] = SPOOL.exec(rest ?? "") ?? [];
      return spool && code
        ? {
            text,
            name: name ?? "",
            code,
            spool,
            target: { kind: "add", id: code, ...(name ? { name } : {}) },
          }
        : plain;
    }
    case "noCode": {
      const [, spool, name] = SPOOL.exec(text) ?? [];
      return spool
        ? { text, name: name ?? "", spool, target: { kind: "spools", id: spool } }
        : plain;
    }
    case "presetsOnly":
    case "presetsNoId": {
      const group = groups.get(text);
      const first = group?.[0];
      if (!group || !first) return plain;
      const printers = shortPrinters(group.map((p) => p.printer));
      const files = group.length;
      return first.filamentId
        ? {
            text,
            name: first.name,
            code: first.filamentId,
            printers,
            files,
            target: { kind: "add", id: first.filamentId, name: first.name },
          }
        : {
            text,
            name: first.name,
            printers,
            files,
            target: { kind: "ids", paths: group.map((p) => p.path) },
          };
    }
    case "badRows":
      return plain;
  }
}

/** A section's items as rows to act on. */
export function itemViews(section: CheckSection, data: CheckData): ItemView[] {
  const groups = presetGroups(data.presets);
  return section.items.map((text) => itemView(section.key, text, groups));
}

/** Section titles short enough for the sections pane; the full title heads the items pane. */
export const SHORT_TITLES: Record<CheckSection["key"], string> = {
  csvOnly: "Filaments without a preset",
  unknownCode: "Spools of unknown filaments",
  badRows: "Misread filament rows",
  presetsOnly: "Presets SpoolEase lacks",
  presetsNoId: "Presets without an ID",
  noCode: "Spools without a code",
};

/** The titles below WIDE_FROM columns, so the items keep the room. */
export const TINY_TITLES: Record<CheckSection["key"], string> = {
  csvOnly: "No preset",
  unknownCode: "Unknown filament",
  badRows: "Misread rows",
  presetsOnly: "Not in SpoolEase",
  presetsNoId: "No filament ID",
  noCode: "No filament code",
};

/** From this many body columns the sections pane has room for the short titles. */
const WIDE_FROM = 100;

export function sectionTitles(ctx: Ctx): Record<CheckSection["key"], string> {
  return ctx.bodyColumns >= WIDE_FROM ? SHORT_TITLES : TINY_TITLES;
}

/**
 * The items pane's title and subtitle: the longest title that fits beside the longest subtitle, then
 * shorter subtitles (counts long first), so neither is cut.
 */
export function itemsTitle(
  ctx: Ctx,
  section: CheckSection,
  subtitles: readonly string[],
  width: number,
): { title: string; subtitle: string } {
  const titles = [section.title, SHORT_TITLES[section.key], TINY_TITLES[section.key]];
  for (const subtitle of subtitles) {
    // Two corners, a space each side of the title, " · " before the subtitle, and a dash or two of border.
    const room = width - (subtitle ? textWidth(subtitle) + 3 : 0) - 6;
    const title = titles.find((t) => textWidth(t) <= room);
    if (title) return { title, subtitle };
  }
  return { title: sectionTitles(ctx)[section.key], subtitle: subtitles.at(-1) ?? "" };
}

/** The warnings shown above the panes: the first, and how many more. */
export function warningLines(warnings: readonly string[]): string[] {
  if (warnings.length === 0) return [];
  const more = warnings.length - 1;
  return [warnings[0] ?? "", ...(more > 0 ? [`… and ${plural(more, "more warning")}`] : [])];
}

/**
 * Columns of a section row besides its title: the list's gutter, the mark and its gap, the gap and
 * the 3-wide count, the scroll column, and the two borders.
 */
const SECTION_CHROME = 1 + 2 + 1 + 3 + 1 + 2;

export interface CheckLayout {
  /** Lines above the panes: the headline and the warnings. */
  top: number;
  /** Both panes' height, borders included. */
  height: number;
  /** The sections pane's width and the items pane's, borders included. */
  left: number;
  right: number;
}

/** Below this many body columns, items with focus take the whole width (esc brings the sections back). */
export const NARROW_BELOW = 70;

export function checkLayout(
  ctx: Ctx,
  data: CheckData | undefined,
  focus: "sections" | "items" = "sections",
): CheckLayout {
  const top = 1 + warningLines(data?.warnings ?? []).length;
  const titles = Object.values(sectionTitles(ctx));
  const left =
    focus === "items" && ctx.bodyColumns < NARROW_BELOW
      ? 0
      : Math.min(
          Math.max(...titles.map(textWidth)) + SECTION_CHROME,
          Math.floor(ctx.bodyColumns / 2),
        );
  return {
    top,
    height: Math.max(3, ctx.bodyRows - top),
    left,
    right: Math.max(0, ctx.bodyColumns - left),
  };
}

/** Margin on each side of text inside a pane. */
export const PAD = 1;

/** The section's why, wrapped to the items pane. */
export function whyLines(
  ctx: Ctx,
  data: CheckData | undefined,
  section: CheckSection,
  focus: "sections" | "items" = "sections",
): string[] {
  const { right, height } = checkLayout(ctx, data, focus);
  return wrapText(section.why, panelInner(right, height).width - 2 * PAD);
}

/**
 * Why a section needing the console wasn't checked: the read's error, then what to check (a gap
 * between), wrapped to the items pane. The key that opens Settings is the footer's alone.
 */
export function offlineLines(
  ctx: Ctx,
  data: CheckData | undefined,
  error: string,
): { error: string[]; advice: string[] } {
  const { right, height } = checkLayout(ctx, data);
  const width = panelInner(right, height).width - 2 * PAD;
  return {
    error: wrapText(`Not checked: ${error}`, width),
    advice: wrapText(consoleProblem(error).advice, width),
  };
}

/**
 * A section's count as its pane's subtitle, long first: presets for the preset sections (and their
 * files when a preset has several, as the ID review writes files), else problems or notes.
 */
export function itemCount(section: CheckSection, items: readonly ItemView[]): string[] {
  if (items.length === 0) return ["none"];
  if (section.key === "presetsOnly" || section.key === "presetsNoId") {
    const files = items.reduce((sum, item) => sum + (item.files ?? 1), 0);
    const presets = plural(items.length, "preset");
    return files === items.length ? [presets] : [`${presets}, ${plural(files, "file")}`, presets];
  }
  return [plural(items.length, section.problem ? "problem" : "note")];
}

/** How many presets and files a set of fixes writes: "1 preset", "1 preset, 2 files". */
export function fixCount(fixes: readonly { name: string }[]): string {
  const presets = new Set(fixes.map((fix) => fix.name)).size;
  const text = plural(presets, "preset");
  return fixes.length === presets ? text : `${text}, ${plural(fixes.length, "file")}`;
}

/** Items the items pane shows at once, below the section's why and a gap. */
export function itemRows(
  ctx: Ctx,
  data: CheckData | undefined,
  section: CheckSection,
  focus: "sections" | "items" = "sections",
): number {
  const { right, height } = checkLayout(ctx, data, focus);
  return Math.max(
    1,
    panelInner(right, height).height - whyLines(ctx, data, section, focus).length - 1,
  );
}

export const IDS_INTRO =
  "Each preset gets the filament ID BambuStudio's Create filament gives a filament of that name, so spools can find their preset.";
export const IDS_NOTE =
  "Logged in to Bambu, BambuStudio uploads the change on its next sync; restart BambuStudio to load it.";

export interface IdsLayout {
  /** The review panel's height, borders included. */
  height: number;
  intro: string[];
  /** Close BambuStudio first, before writing (its icon's room left at the start); empty once written. */
  warning: string[];
  note: string[];
  /** Files shown at once. */
  rows: number;
}

/**
 * The ID review: a panel (its title says where you are) with the intro, the warning while nothing is
 * written yet (before tells), the files, the status line and the note.
 */
export function idsLayout(ctx: Ctx, before: boolean): IdsLayout {
  const height = Math.max(3, ctx.bodyRows);
  const inner = panelInner(ctx.bodyColumns, height);
  const intro = wrapText(IDS_INTRO, inner.width - 2 * PAD);
  const warning = before ? wrapText(CLOSE_BAMBUSTUDIO_FIRST, inner.width - 2 * PAD - 2) : [];
  const note = wrapText(IDS_NOTE, inner.width - 2 * PAD);
  // A gap after the intro, the warning and its gap, and the column header; a gap, the status line,
  // a gap and the note below.
  const warned = warning.length ? warning.length + 1 : 0;
  const rows = Math.max(1, inner.height - intro.length - 2 - warned - 3 - note.length);
  return { height, intro, warning, note, rows };
}

/** Whether the ID review still says to close BambuStudio: nothing written or writing yet. */
export function idsBefore(ids: { results: unknown[] | null; running: boolean }): boolean {
  return ids.results === null && !ids.running;
}
