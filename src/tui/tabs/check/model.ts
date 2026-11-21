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
import { moveCursor } from "../../ui/index.js";
import { writeIds } from "./cmds.js";
import { checkView, consoleConfigured, firstWithItems, idRows, itemRows } from "./report.js";

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
  /** sections: ↑↓ pick a section; items: ↑↓ scroll its items. */
  focus: "sections" | "items";
  /** First item shown of the highlighted section. */
  scroll: number;
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
    scroll: 0,
    placed: false,
    ids: null,
  };
  return consoleConfigured(ctx) ? step(model, loadCheck()) : step(model);
}

/** Presets without an ID in the check as it is now (only a finished check: one reloading may be stale). */
function fixesNow(ctx: Ctx): IdFix[] {
  const view = checkView(ctx);
  return view.kind === "ready" && view.data ? idFixes(view.data.presets) : [];
}

function sectionsNow(ctx: Ctx) {
  return checkView(ctx).data?.sections ?? [];
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Keeps the cursor and scroll inside the check as it is now. */
function clamp(model: CheckModel, ctx: Ctx): CheckModel {
  const sections = sectionsNow(ctx);
  const section = Math.max(0, Math.min(model.section, sections.length - 1));
  const items = sections[section]?.items.length ?? 0;
  const scroll = Math.max(0, Math.min(model.scroll, items - itemRows(ctx)));
  const focus = items === 0 ? "sections" : model.focus;
  return { ...model, section, scroll, focus };
}

function openIds(model: CheckModel, ctx: Ctx): Step<CheckModel> {
  const fixes = fixesNow(ctx);
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
  const last = Math.max(0, ids.fixes.length - idRows(ctx));
  const moved = moveCursor(ids.scroll, key, last + 1, idRows(ctx));
  return moved === null ? step(model) : step({ ...model, ids: { ...ids, scroll: moved } });
}

function reportKey(model: CheckModel, key: KeyPress, ctx: Ctx): Step<CheckModel> {
  const typed = letter(key);
  if (typed === "r") return step(model, loadCheck(true));
  if (typed === "f") return openIds(model, ctx);
  const sections = sectionsNow(ctx);
  const items = sections[model.section]?.items.length ?? 0;
  if (model.focus === "items") {
    if (key.name === "esc" || key.name === "left") return step({ ...model, focus: "sections" });
    const last = Math.max(0, items - itemRows(ctx));
    const moved = moveCursor(model.scroll, key, last + 1, itemRows(ctx));
    return moved === null ? step(model) : step({ ...model, scroll: moved });
  }
  if ((key.name === "enter" || key.name === "right") && items > 0)
    return step({ ...model, focus: "items" });
  const moved = moveCursor(model.section, key, sections.length, sections.length);
  return moved === null ? step(model) : step({ ...model, section: moved, scroll: 0 });
}

function keyStep(model: CheckModel, key: KeyPress, ctx: Ctx): Step<CheckModel> {
  if (!consoleConfigured(ctx))
    return key.name === "enter"
      ? step(model, send<AppMsg>({ type: "app/switchTab", tab: "settings" }))
      : step(model);
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
  const written = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  const lines = [
    `${plural(written, "BambuStudio preset")} given a filament ID${failed.length ? `, ${failed.length} failed` : ""}: restart BambuStudio to load`,
    ...failed.map((r) => `${basename(r.path)}: ${r.detail}`),
  ];
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
              failed.length === results.length
                ? `${plural(failed.length, "preset")} not given an ID`
                : `${failed.length} of ${results.length} presets not given an ID`,
            tone: "failed",
          }
        : {
            type: "app/toast",
            text: `${plural(written, "preset")} given a filament ID: restart BambuStudio`,
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
      if (msg.resource !== "check" || !view.data) return step(model);
      const placed =
        model.placed || view.kind !== "ready"
          ? model
          : { ...model, placed: true, section: firstWithItems(view.data.sections) };
      return step(clamp(placed, ctx));
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
    const scrolls = ids.fixes.length > idRows(ctx);
    if (ids.running) return [{ keys: "esc", label: "back" }];
    if (ids.results) return [{ keys: "esc", label: "back to the check", primary: true }];
    return [
      ...(scrolls ? [{ keys: "↑↓", label: "scroll" }] : []),
      { keys: "a", label: `write ${plural(ids.fixes.length, "filament ID")}`, primary: true },
      { keys: "esc", label: "back" },
    ];
  }
  const sections = view.data?.sections ?? [];
  const items = sections[model.section]?.items.length ?? 0;
  const fixes = fixesNow(ctx).length;
  const fix: Hint[] = fixes
    ? [{ keys: "f", label: `give ${plural(fixes, "preset")} an ID`, primary: true }]
    : [];
  const again: Hint[] = view.kind === "loading" ? [] : [{ keys: "r", label: "check again" }];
  if (!view.data) return again;
  if (model.focus === "items")
    return [{ keys: "↑↓", label: "scroll" }, { keys: "esc", label: "sections" }, ...fix, ...again];
  return [
    { keys: "↑↓", label: "sections" },
    ...(items > 0 ? [{ keys: "enter", label: "items" }] : []),
    ...fix,
    ...again,
  ];
}

function commands(_model: CheckModel, ctx: Ctx): PaletteCommand[] {
  if (!consoleConfigured(ctx)) return [];
  return [
    { title: "Check again", detail: "Check", msg: toTab("check", { type: "check/recheck" }) },
    ...(fixesNow(ctx).length
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
  commands,
};
