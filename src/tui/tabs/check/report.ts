// ABOUTME: What the Check tab shows from the sync check: its state, a row per section, the headline and its layout.
// ABOUTME: Pure functions over the shell's check resource and the session's values; the console URL never has the key.

import { type CheckSection, checkCounts, checkSummary } from "../../../syncCheck.js";
import type { CheckData, Ctx } from "../../core/types.js";
import { consoleUrl, panelInner } from "../../ui/index.js";
import { connectionOf } from "../settings/connection.js";
import { wrapText } from "../settings/wrap.js";

/** none: no console to check against (SpoolEase skipped or not set up). */
export interface CheckView {
  kind: "none" | "loading" | "ready" | "failed";
  /** The check to show: the current one, or the last good one while reloading or after a failure. */
  data?: CheckData;
  error?: string;
}

export function consoleConfigured(ctx: Ctx): boolean {
  return connectionOf(ctx.values) !== null;
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
    case "failed":
      return {
        kind: "failed",
        error: check.error,
        ...(check.previous ? { data: check.previous } : {}),
      };
  }
}

export interface SectionRow {
  key: CheckSection["key"];
  title: string;
  count: number;
  /** ok: nothing in it; problem: it breaks a spool's link to its preset; note: worth knowing. */
  tone: "ok" | "problem" | "note";
}

export function sectionRows(sections: CheckSection[]): SectionRow[] {
  return sections.map((section) => ({
    key: section.key,
    title: section.title,
    count: section.items.length,
    tone: section.items.length === 0 ? "ok" : section.problem ? "problem" : "note",
  }));
}

/** The first section with something in it, else the first. */
export function firstWithItems(sections: CheckSection[]): number {
  return Math.max(
    0,
    sections.findIndex((section) => section.items.length > 0),
  );
}

export interface Headline {
  /** "Everything lines up" or "N problems, M notes". */
  text: string;
  tone: "ok" | "problem" | "note";
  /** What was compared: the preset folder and the console's URL. */
  compared: string;
}

export function checkHeadline(sections: CheckSection[], ctx: Ctx): Headline {
  const { problems, notes } = checkCounts(sections);
  const connection = connectionOf(ctx.values);
  return {
    text: checkSummary(sections),
    tone: problems > 0 ? "problem" : notes > 0 ? "note" : "ok",
    compared: [
      `BambuStudio ${ctx.values.presetFolder.trim()}`,
      ...(connection ? [consoleUrl(connection)] : []),
    ].join(" · "),
  };
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

/** The warnings shown above the panes: the first, and how many more. */
export function warningLines(warnings: readonly string[]): string[] {
  if (warnings.length === 0) return [];
  const more = warnings.length - 1;
  return [warnings[0] ?? "", ...(more > 0 ? [`… and ${plural(more, "more warning")}`] : [])];
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The sections pane's width, borders included, where there's room for it. */
const SECTIONS_WIDTH = 37;

export interface CheckLayout {
  /** Lines above the panes: the headline and the warnings. */
  top: number;
  /** Both panes' height, borders included. */
  height: number;
  /** The sections pane's width and the items pane's, borders included. */
  left: number;
  right: number;
}

export function checkLayout(ctx: Ctx, data: CheckData | undefined): CheckLayout {
  const top = 1 + warningLines(data?.warnings ?? []).length;
  // Room for the longest short title with its mark and count; narrower terminals give the items more.
  const left = ctx.bodyColumns >= 80 ? SECTIONS_WIDTH : Math.floor(ctx.bodyColumns * 0.46);
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
export function whyLines(ctx: Ctx, data: CheckData | undefined, section: CheckSection): string[] {
  const { right, height } = checkLayout(ctx, data);
  return wrapText(section.why, panelInner(right, height).width - 2 * PAD);
}

/** Items the items pane shows at once, below the section's why and a gap. */
export function itemRows(ctx: Ctx, data: CheckData | undefined, section: CheckSection): number {
  const { right, height } = checkLayout(ctx, data);
  return Math.max(1, panelInner(right, height).height - whyLines(ctx, data, section).length - 1);
}

export const IDS_INTRO =
  "Each preset gets the filament ID BambuStudio's Create filament gives a filament of that name, so spools can find their preset.";
export const IDS_NOTE =
  "Logged in to Bambu, BambuStudio uploads the change on its next sync; restart BambuStudio to load it.";

export interface IdsLayout {
  /** The review panel's height, borders included (the page bar is above it). */
  height: number;
  intro: string[];
  note: string[];
  /** Files shown at once. */
  rows: number;
}

/** The ID review: page bar, then a panel with the intro, the files, the status line and the note. */
export function idsLayout(ctx: Ctx): IdsLayout {
  const height = Math.max(3, ctx.bodyRows - 1);
  const inner = panelInner(ctx.bodyColumns, height);
  const intro = wrapText(IDS_INTRO, inner.width - 2 * PAD);
  const note = wrapText(IDS_NOTE, inner.width - 2 * PAD);
  // A gap after the intro and the column header; a gap, the status line, a gap and the note below.
  const rows = Math.max(1, inner.height - intro.length - 2 - 3 - note.length);
  return { height, intro, note, rows };
}
