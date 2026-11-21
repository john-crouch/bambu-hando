// ABOUTME: The Check tab's model and pure update: the sync check's sections and items, and the filament ID review.
// ABOUTME: Reads only the shell's check resource; the one write (IDs into presets) waits on the review's a.

import { basename } from "node:path";

import { type IdFix, type IdFixResult, idFixes } from "../../../presetIds.js";
import { type KeyPress, letter } from "../../core/keys.js";
import { send } from "../../core/program.js";
import type {
  AppMsg,
  Ctx,
  Hint,
  PaletteCommand,
  Step,
  TabModule,
  TabMsg,
} from "../../core/types.js";
import { toTab } from "../../core/types.js";
import { moveCursor, plural } from "../../ui/index.js";
import { writeIds } from "./cmds.js";
import {
  checkView,
  consoleConfigured,
  firstWithItems,
  type ItemTarget,
  idsLayout,
  itemRows,
  itemViews,
  NARROW_BELOW,
  needsConsole,
  sectionIndex,
  targetLabel,
} from "./report.js";

export interface IdsPage {
  fixes: IdFix[];
  /** null until written. */
  results: IdFixResult[] | null;
  running: boolean;
  /** First file shown. */
  scroll: number;
}

export interface CheckModel {
  page: "report" | "ids";
  /** The highlighted section. */
  section: number;
  /** sections: ↑↓ pick a section; items: ↑↓ pick one of its items, enter goes to its fix. */
  focus: "sections" | "items";
  /** The highlighted item of the highlighted section. */
  item: number;
  /** Whether the cursor has been put on the first section with items, which happens once. */
  placed: boolean;
  ids: IdsPage | null;
}

const step = (model: CheckModel, ...cmds: Step<CheckModel>[1]): Step<CheckModel> => [model, cmds];

const loadCheck = (force?: boolean) =>
  send<AppMsg>({ type: "app/load", resource: "check", ...(force ? { force } : {}) });

function init(ctx: Ctx): Step<CheckModel> {
  const model: CheckModel = {
    page: "report",
    section: 0,
    focus: "sections",
    item: 0,
    placed: false,
    ids: null,
  };
  return consoleConfigured(ctx) ? step(model, loadCheck()) : step(model);
}

/**
 * Presets without an ID in the check as it is now: a finished check, or BambuStudio's presets read on their
 * own when the console can't be reached (a check reloading may be stale).
 */
function fixesNow(ctx: Ctx): IdFix[] {
  const view = checkView(ctx);
  return (view.kind === "ready" || view.offline) && view.data ? idFixes(view.data.presets) : [];
}

/** How many presets the fixes are for: one per filament name, however many printers' files it has. */
function presetCount(fixes: readonly IdFix[]): number {
  return new Set(fixes.map((fix) => fix.name)).size;
}

function sectionsNow(ctx: Ctx) {
  return checkView(ctx).data?.sections ?? [];
}

/** Items of the highlighted section shown at once. */
function shownItems(model: CheckModel, ctx: Ctx): number {
  const data = checkView(ctx).data;
  const section = data?.sections[model.section];
  return section ? itemRows(ctx, data, section, model.focus) : 1;
}

/** Keeps the cursor and scroll inside the check as it is now. */
function clamp(model: CheckModel, ctx: Ctx): CheckModel {
  const sections = sectionsNow(ctx);
  const section = Math.max(0, Math.min(model.section, sections.length - 1));
  const items = sections[section]?.items.length ?? 0;
  const item = Math.max(0, Math.min(model.item, items - 1));
  const focus = items === 0 ? "sections" : model.focus;
  return { ...model, section, item, focus };
}

/** The ID review, for every preset without an ID or only those files; the running one while it writes. */
function openIds(model: CheckModel, ctx: Ctx, paths?: readonly string[]): Step<CheckModel> {
  if (model.ids?.running) return step({ ...model, page: "ids" });
  const fixes = fixesNow(ctx).filter((fix) => !paths || paths.includes(fix.path));
  if (fixes.length === 0) return step(model);
  return step({
    ...model,
    page: "ids",
    ids: { fixes, results: null, running: false, scroll: 0 },
  });
}

function idsKey(model: CheckModel, ids: IdsPage, key: KeyPress, ctx: Ctx): Step<CheckModel> {
  if (key.name === "esc")
    // Results still to come are kept so they land on the page; finished ones are done with.
    return step({ ...model, page: "report", ids: ids.running ? ids : null });
  if (letter(key) === "a" && ids.results === null && !ids.running)
    return step({ ...model, ids: { ...ids, running: true } }, writeIds(ids.fixes));
  const rows = idsLayout(ctx).rows;
  const last = Math.max(0, ids.fixes.length - rows);
  const moved = moveCursor(ids.scroll, key, last + 1, rows);
  return moved === null ? step(model) : step({ ...model, ids: { ...ids, scroll: moved } });
}

/** Where an item's fix is: another tab (a deep link), or the ID review here. */
function goToFix(model: CheckModel, target: ItemTarget, ctx: Ctx): Step<CheckModel> {
  if (target.kind === "ids") return openIds(model, ctx, target.paths);
  return step(model, send<AppMsg>({ type: "app/switchTab", tab: target.kind, focus: target.id }));
}

/** The highlighted section's items to act on; none for a section the console couldn't tell about. */
function currentItems(model: CheckModel, ctx: Ctx) {
  const view = checkView(ctx);
  const section = view.data?.sections[model.section];
  if (!section || !view.data || (view.offline && needsConsole(section.key))) return [];
  return itemViews(section, view.data);
}

/** The highlighted section waits for a console that couldn't be read. */
function offlineSection(model: CheckModel, ctx: Ctx): boolean {
  const view = checkView(ctx);
  const section = view.data?.sections[model.section];
  return Boolean(view.offline && section && needsConsole(section.key));
}

const toConsoleSettings = (ctx: Ctx) =>
  send<AppMsg>({
    type: "app/switchTab",
    tab: "settings",
    focus: ctx.values.skipSpoolease ? "spoolease.skip" : "spoolease.host",
  });

function reportKey(model: CheckModel, key: KeyPress, ctx: Ctx): Step<CheckModel> {
  const typed = letter(key);
  if (typed === "r") return step(model, loadCheck(true));
  if (typed === "f") return openIds(model, ctx);
  const sections = sectionsNow(ctx);
  const items = currentItems(model, ctx);
  if (model.focus === "items") {
    if (key.name === "esc" || key.name === "left") return step({ ...model, focus: "sections" });
    const target = items[model.item]?.target;
    if (key.name === "enter") return target ? goToFix(model, target, ctx) : step(model);
    const moved = moveCursor(model.item, key, items.length, shownItems(model, ctx));
    return moved === null ? step(model) : step({ ...model, item: moved });
  }
  if (key.name === "enter" && offlineSection(model, ctx))
    return step(model, toConsoleSettings(ctx));
  if ((key.name === "enter" || key.name === "right") && items.length > 0)
    return step({ ...model, focus: "items" });
  const moved = moveCursor(model.section, key, sections.length, sections.length);
  return moved === null ? step(model) : step({ ...model, section: moved, item: 0 });
}

/** Opens on the section a deep link names, its items focused; a running write keeps its review on screen. */
function focusSection(model: CheckModel, focus: string, ctx: Ctx): CheckModel {
  if (model.ids?.running) return { ...model, page: "ids" };
  const index = sectionIndex(sectionsNow(ctx), focus);
  if (index < 0) return model;
  const opened = { ...model, page: "report" as const, section: index, item: 0, placed: true };
  return clamp({ ...opened, focus: "items" }, ctx);
}

function keyStep(model: CheckModel, key: KeyPress, ctx: Ctx): Step<CheckModel> {
  if (!consoleConfigured(ctx))
    return key.name === "enter" ? step(model, toConsoleSettings(ctx)) : step(model);
  // Set up since the tab started, and nobody asked for the check yet.
  const ask = ctx.resources.check.state === "idle" ? [loadCheck()] : [];
  const [next, cmds] =
    model.page === "ids" && model.ids
      ? idsKey(model, model.ids, key, ctx)
      : reportKey(model, key, ctx);
  return [next, [...ask, ...cmds]];
}

/** The outcome of an ID write, as the session summary, the toast and the reloads it needs. */
function idsWritten(model: CheckModel, results: IdFixResult[]): Step<CheckModel> {
  const written = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const head =
    written.length === 0
      ? `${plural(presetCount(failed), "BambuStudio preset")} not given a filament ID`
      : `${plural(presetCount(written), "BambuStudio preset")} given a filament ID${failed.length ? `, ${plural(failed.length, "file")} failed` : ""}: restart BambuStudio to load`;
  const lines = [head, ...failed.map((r) => `${basename(r.path)}: ${r.detail}`)];
  const ids = model.ids ? { ...model.ids, results, running: false } : null;
  return step(
    { ...model, ids },
    send<AppMsg>(
      {
        type: "app/runFinished",
        summary: failed.length ? { ok: false, exitCode: 1, lines } : { ok: true, lines },
      },
      { type: "app/load", resource: "presets", force: true },
      { type: "app/load", resource: "check", force: true },
      failed.length
        ? {
            type: "app/toast",
            text:
              written.length === 0
                ? `${plural(presetCount(failed), "preset")} not given an ID`
                : `${failed.length} of ${plural(results.length, "file")} not given an ID`,
            tone: "failed",
          }
        : {
            type: "app/toast",
            text: `${plural(presetCount(written), "preset")} given a filament ID: restart BambuStudio`,
            tone: "ok",
          },
    ),
  );
}

function update(model: CheckModel, msg: AppMsg | TabMsg, ctx: Ctx): Step<CheckModel> {
  switch (msg.type) {
    case "key":
      return keyStep(model, (msg as Extract<AppMsg, { type: "key" }>).key, ctx);
    case "app/loaded": {
      if (consoleConfigured(ctx) && ctx.resources.check.state === "idle")
        return step(model, loadCheck());
      const view = checkView(ctx);
      // Without the console, BambuStudio's presets still tell which have no ID.
      const ask =
        msg.resource === "check" && view.kind === "failed" && !view.data
          ? [send<AppMsg>({ type: "app/load", resource: "presets" })]
          : [];
      const relevant = msg.resource === "check" || (msg.resource === "presets" && view.offline);
      if (!relevant || !view.data) return step(model, ...ask);
      const placed =
        model.placed || (view.kind !== "ready" && !view.offline)
          ? model
          : { ...model, placed: true, section: firstWithItems(view.data.sections) };
      return step(clamp(placed, ctx), ...ask);
    }
    case "app/switchTab": {
      const focus = (msg as Extract<AppMsg, { type: "app/switchTab" }>).focus;
      return step(focus ? focusSection(model, focus, ctx) : model);
    }
    case "check/idsWritten":
      return idsWritten(model, msg.results as IdFixResult[]);
    case "check/recheck":
      return consoleConfigured(ctx) ? step(model, loadCheck(true)) : step(model);
    case "check/fix": {
      const [next, cmds] = openIds(model, ctx);

      return [next, [send<AppMsg>({ type: "app/switchTab", tab: "check" }), ...cmds]];
    }
    default:
      return step(model);
  }
}

function hints(model: CheckModel, ctx: Ctx): Hint[] {
  const view = checkView(ctx);
  if (view.kind === "none")
    return [{ keys: "enter", label: "set up SpoolEase in Settings", primary: true }];
  if (model.page === "ids" && model.ids) {
    const ids = model.ids;
    const scrolls = ids.fixes.length > idsLayout(ctx).rows;
    if (ids.running) return [{ keys: "esc", label: "back" }];
    if (ids.results) return [{ keys: "esc", label: "back to the check", primary: true }];
    return [
      ...(scrolls ? [{ keys: "↑↓", label: "scroll" }] : []),
      { keys: "a", label: `write ${plural(ids.fixes.length, "file")}`, primary: true },
      { keys: "esc", label: "back" },
    ];
  }
  const fixes = presetCount(fixesNow(ctx));
  const fix: Hint[] =
    fixes && !model.ids?.running
      ? [{ keys: "f", label: `give ${plural(fixes, "preset")} an ID`, primary: true }]
      : model.ids?.running
        ? [{ keys: "f", label: "see the IDs being written", primary: true }]
        : [];
  const again: Hint[] = view.kind === "loading" ? [] : [{ keys: "r", label: "check again" }];
  if (!view.data) return again;
  if (model.focus === "items") {
    const item = currentItems(model, ctx)[model.item];
    const section = view.data.sections[model.section];
    return [
      { keys: "↑↓", label: "move" },
      ...(item?.target && section
        ? [{ keys: "enter", label: targetLabel(section.key, item.target), primary: true }]
        : []),
      // Below NARROW_BELOW the sections pane is hidden meanwhile: esc is the way back to it.
      {
        keys: "esc",
        label: "sections",
        ...(ctx.bodyColumns < NARROW_BELOW ? { primary: true } : {}),
      },
      ...fix,
      ...again,
    ];
  }
  const opens = offlineSection(model, ctx)
    ? [{ keys: "enter", label: "open Settings", primary: true }]
    : currentItems(model, ctx).length > 0
      ? [{ keys: "enter", label: "items" }]
      : [];
  return [{ keys: "↑↓", label: "sections" }, ...opens, ...fix, ...again];
}

/** What's being written: the filament IDs, while the review's write runs. */
function busy(model: CheckModel): string | null {
  return model.ids?.running ? "Writing filament IDs into BambuStudio presets" : null;
}

function commands(model: CheckModel, ctx: Ctx): PaletteCommand[] {
  if (!consoleConfigured(ctx)) return [];
  return [
    { title: "Check again", detail: "Check", msg: toTab("check", { type: "check/recheck" }) },
    ...(fixesNow(ctx).length || model.ids?.running
      ? [
          {
            title: "Give presets a filament ID",
            detail: "Check",
            msg: toTab("check", { type: "check/fix" }),
          },
        ]
      : []),
  ];
}

/** The Check tab without its view (the view joins it in index.ts). */
export const checkLogic: Omit<TabModule<CheckModel>, "View"> = {
  id: "check",
  title: "Check",
  init,
  update,
  hints,
  capturesText: () => false,
  busy,
  commands,
};
