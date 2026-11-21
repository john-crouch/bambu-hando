// ABOUTME: What the Check tab shows from the sync check: its state, a row per section, the headline and pane sizes.
// ABOUTME: Pure functions over the shell's check resource and the session's values; the console URL never has the key.

import { type CheckSection, checkCounts, checkSummary } from "../../../syncCheck.js";
import type { CheckData, Ctx } from "../../core/types.js";
import { connectionOf, consoleUrl } from "../settings/connection.js";

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

// The summary line, the items panel's borders, the section's why (two lines), a gap and a spare line.
const ITEMS_CHROME = 7;

/** Items the right pane shows at once. */
export function itemRows(ctx: Ctx): number {
  return Math.max(1, ctx.bodyRows - ITEMS_CHROME);
}

// The review's title, two lines on what happens, the panel's borders, a gap and a spare line.
const IDS_CHROME = 7;

/** Files the ID review shows at once. */
export function idRows(ctx: Ctx): number {
  return Math.max(1, ctx.bodyRows - IDS_CHROME);
}
