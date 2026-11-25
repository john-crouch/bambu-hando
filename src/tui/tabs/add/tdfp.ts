// ABOUTME: Importing your 3DFilamentProfiles spools from the Add tab: its model, the list's rows, and the pure updates for
// ABOUTME: the list on Find, its Review and its Run/Done; Add's update routes here while the import is what's shown.

import type { TdfpSpool } from "../../../filamentProfiles.js";
import type { ProfilePlan } from "../../../planPreview.js";
import type { SyncStage } from "../../../sync.js";
import type { ImportItem, PreparedImport } from "../../../tdfpImport.js";
import type { ImportPreviewRow } from "../../../tdfpImportSession.js";
import { isCtrl, type KeyPress, letter } from "../../core/keys.js";
import { send } from "../../core/program.js";
import type { AppMsg, Ctx, Hint, RunSummary, Step } from "../../core/types.js";
import type { FormValues } from "../../core/values.js";
import { plural } from "../../ui/format.js";
import { moveCursor, typeAhead } from "../../ui/list.js";
import { consoleProblem } from "../settings/connection.js";
import type { AddModel, FindFrame } from "./model.js";
import {
  errorFocus,
  type PlanBasis,
  planBasis,
  runError,
  runErrorFocus,
  sameBasis,
} from "./targets.js";
import {
  consoleKey,
  type TdfpMsg,
  type TdfpOutcome,
  type TdfpProblem,
  tdfpApplyCmd,
  tdfpListCmd,
  tdfpPrepareCmd,
} from "./tdfpCmds.js";

type Result = Step<AddModel>;

/** The deep link (app/switchTab focus) that opens the list. */
export const TDFP_FOCUS = "3dfp";

export interface TdfpListModel {
  state: "idle" | "loading" | "ready" | "failed";
  /** The console it was read for (consoleKey): the links are kept per console. */
  console: string;
  /** The spools not linked to this console yet. */
  rows: ImportPreviewRow[];
  /** Spools linked to it already. */
  linked: number;
  warnings: string[];
  error: string;
  problem: TdfpProblem | null;
}

export interface TdfpReviewModel {
  state: "loading" | "ready" | "failed";
  /** Which read is current; a reply for an older one is dropped. */
  seq: number;
  /** The 3DFP short codes reviewed, in the list's order. */
  codes: string[];
  prepared: PreparedImport | null;
  /** Per prepared item: its presets and custom filament as they are now; null when that couldn't be read. */
  plans: ProfilePlan[] | null;
  /** API calls reading took, and those applying takes. */
  calls: number;
  linkCalls: number;
  warnings: string[];
  error: string;
  problem: TdfpProblem | null;
  cursor: number;
  /** The settings it was read with; a review read with others is read again. */
  basis: PlanBasis;
  /** Why applying can't start (settings), shown until the next key. */
  refusal: string;
}

export interface TdfpRunModel {
  state: "running" | "done" | "failed";
  items: ImportItem[];
  stage: SyncStage | null;
  outcomes: TdfpOutcome[];
  warnings: string[];
  error: string;
  /** API calls the review and the run took together. */
  calls: number;
  wrotePresets: boolean;
  cursor: number;
}

export interface TdfpModel {
  list: TdfpListModel;
  /** Ticked spools by short code; kept until they're imported. */
  selected: ReadonlySet<string>;
  review: TdfpReviewModel | null;
  run: TdfpRunModel | null;
  /** Review and Done show the import, not a SpoolmanDB run. */
  active: boolean;
  seq: number;
}

export function emptyTdfp(): TdfpModel {
  return {
    list: {
      state: "idle",
      console: "",
      rows: [],
      linked: 0,
      warnings: [],
      error: "",
      problem: null,
    },
    selected: new Set(),
    review: null,
    run: null,
    active: false,
    seq: 0,
  };
}

/** "SUNLU PETG Elite Mildewed Red": a spool as 3DFP names it. */
export function spoolName(spool: TdfpSpool): string {
  return [spool.brand, spool.material, spool.materialType, spool.color]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "#RRGGBB" for a spool's swatch; gray when 3DFP has no color for it. */
export function spoolSwatch(spool: TdfpSpool): string {
  const hex = (spool.rgb ?? "").replace(/^#/, "").slice(0, 6);
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toUpperCase()}` : "#808080";
}

const tickable = (row: ImportPreviewRow): boolean => row.refusal === null;

/** Find is on the 3DFP list. */
export function onTdfpLevel(model: AddModel): boolean {
  return !model.search && model.stack.at(-1)?.level.kind === "tdfp";
}

/** The import is what the tab shows: its list on Find, or its Review and Done. */
export function showsTdfp(model: AddModel): boolean {
  return model.page === "find" ? onTdfpLevel(model) : model.tdfp.active;
}

/** The ticked spools that can be imported, in the list's order. */
export function tickedRows(model: AddModel): ImportPreviewRow[] {
  const { list, selected } = model.tdfp;
  return list.rows.filter((row) => tickable(row) && selected.has(row.spool.shortCode));
}

/** "2 ticked: SUNLU PETG ×2", or "" when nothing is. */
export function tdfpTray(model: AddModel): string {
  const rows = tickedRows(model);
  if (rows.length === 0) return "";
  const counts = new Map<string, number>();
  for (const { spool } of rows) {
    const label = `${spool.brand} ${spool.material}`;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const parts = [...counts].map(([label, count]) => (count > 1 ? `${label} ×${count}` : label));
  return `${rows.length} ticked: ${parts.join(" · ")}`;
}

/** Why the import can't run with these settings, or "". It makes SpoolEase spools, so the console must be on. */
export function importError(values: FormValues): string {
  if (values.skipSpoolease)
    return "Importing makes SpoolEase spools: turn Use SpoolEase on in Settings";
  return runError(values);
}

/** The Settings row that fixes importError's problem, or null. */
export function importErrorFocus(values: FormValues): string | null {
  return values.skipSpoolease ? "spoolease.skip" : runErrorFocus(values);
}

/** The Settings row that sets up the console the list needs. */
function consoleFocus(values: FormValues): string {
  return importErrorFocus(values) ?? "spoolease.host";
}

function toSettings(focus: string): ReturnType<typeof send<AppMsg>> {
  return send<AppMsg>({ type: "app/switchTab", tab: "settings", focus });
}

function clampIndex(index: number, count: number): number {
  return Math.max(0, Math.min(index, count - 1));
}

function pageRows(ctx: Ctx): number {
  return Math.max(1, ctx.bodyRows - 8);
}

function top(model: AddModel): FindFrame {
  return model.stack.at(-1) ?? { level: { kind: "tdfp" }, cursor: 0 };
}

function withCursor(model: AddModel, cursor: number): AddModel {
  return { ...model, stack: [...model.stack.slice(0, -1), { ...top(model), cursor }] };
}

function withTdfp(model: AddModel, changes: Partial<TdfpModel>): AddModel {
  return { ...model, tdfp: { ...model.tdfp, ...changes } };
}

/** The 3DFP row's place among the sources: after SpoolmanDB and the import, when there is one. */
export function tdfpRootIndex(model: AddModel): number {
  return model.imported.source === null ? 1 : 2;
}

/** Reads the list unless it's read (or being read) for this console already; force reads it again. */
export function loadList(model: AddModel, ctx: Ctx, force = false): Result {
  const console = consoleKey(ctx.values);
  const { list } = model.tdfp;
  if (!console) return [model, []];
  // A read that failed before reaching 3DFP (no key, the console) is tried again each time the list is shown, since
  // the cause may be fixed by now; one 3DFP refused only on r, so showing the list never spends a call.
  const retry = list.state === "failed" && list.problem !== "other";
  const current = list.console === console && list.state !== "idle" && !retry;
  if (current && !force) return [model, []];
  return [
    withTdfp(model, {
      list: {
        ...emptyTdfp().list,
        state: "loading",
        console,
        rows: list.console === console ? list.rows : [],
        linked: list.console === console ? list.linked : 0,
      },
    }),
    [tdfpListCmd(ctx.values)],
  ];
}

/** Find shows the 3DFP list (from anywhere), read the first time it's shown for this console. */
export function openTdfp(model: AddModel, ctx: Ctx): Result {
  const onIt = model.page === "find" && onTdfpLevel(model);
  const stack: FindFrame[] = onIt
    ? model.stack
    : [
        { level: { kind: "root" }, cursor: tdfpRootIndex(model) },
        { level: { kind: "tdfp" }, cursor: 0 },
      ];
  return loadList(
    {
      ...model,
      page: "find",
      search: null,
      dialog: null,
      run: null,
      stack,
      tdfp: { ...model.tdfp, active: false, run: null },
    },
    ctx,
  );
}

/** Find is on the list again (Add shown, the console maybe changed): read it if it's for another console. */
export function shownTdfp(model: AddModel, ctx: Ctx): Result {
  if (model.page === "find" && onTdfpLevel(model)) return loadList(model, ctx);
  const { review } = model.tdfp;
  if (
    model.tdfp.active &&
    model.page === "review" &&
    review &&
    !sameBasis(review.basis, planBasis(ctx.values))
  )
    return enterReview(model, ctx, review.codes, true);
  return [model, []];
}

// ── Messages ────────────────────────────────────────────────────────────────

export function tdfpUpdate(model: AddModel, msg: TdfpMsg, ctx: Ctx): Result {
  const { list, review, run } = model.tdfp;
  switch (msg.type) {
    case "add/tdfpListed": {
      if (msg.console !== list.console) return [model, []];
      const codes = new Set(msg.rows.filter(tickable).map((row) => row.spool.shortCode));
      const selected = new Set([...model.tdfp.selected].filter((code) => codes.has(code)));
      const next = withTdfp(model, {
        list: {
          ...list,
          state: "ready",
          rows: msg.rows,
          linked: msg.linked,
          warnings: msg.warnings,
        },
        selected,
      });
      return [
        onTdfpLevel(next) ? withCursor(next, clampIndex(top(next).cursor, msg.rows.length)) : next,
        [],
      ];
    }
    case "add/tdfpListFailed":
      if (msg.console !== list.console) return [model, []];
      return [
        withTdfp(model, {
          list: { ...list, state: "failed", error: msg.error, problem: msg.problem },
        }),
        [],
      ];
    case "add/tdfpPrepared":
      if (!review || msg.seq !== review.seq) return [model, []];
      return [
        withTdfp(model, {
          review: {
            ...review,
            state: "ready",
            prepared: msg.prepared,
            plans: msg.plans,
            calls: msg.calls,
            linkCalls: msg.linkCalls,
            warnings: msg.warnings,
            cursor: clampIndex(
              review.cursor,
              msg.prepared.items.length + msg.prepared.refused.length,
            ),
          },
        }),
        [],
      ];
    case "add/tdfpPrepareFailed":
      if (!review || msg.seq !== review.seq) return [model, []];
      return [
        withTdfp(model, {
          review: { ...review, state: "failed", error: msg.error, problem: msg.problem },
        }),
        [],
      ];
    case "add/tdfpRunEvent": {
      if (run?.state !== "running") return [model, []];
      const { event } = msg;
      if (event.type === "stage")
        return [withTdfp(model, { run: { ...run, stage: event.stage } }), []];
      if (event.type === "warning")
        return [
          withTdfp(model, { run: { ...run, warnings: [...run.warnings, event.message] } }),
          [],
        ];
      return [model, []];
    }
    case "add/tdfpApplied":
      return applied(model, msg, ctx);
    case "add/tdfpApplyFailed":
      return applyFailed(model, msg.error, msg.exitCode, ctx);
    case "add/openTdfp": {
      if (running(model)) return [model, []];
      const [next, cmds] = openTdfp(model, ctx);
      return [next, [send<AppMsg>({ type: "app/switchTab", tab: "add" }), ...cmds]];
    }
  }
}

/** Some write of the tab's is running: the import's or a SpoolmanDB run's. */
export function running(model: AddModel): boolean {
  return model.run?.state === "running" || model.tdfp.run?.state === "running";
}

// ── The list on Find ────────────────────────────────────────────────────────

/** The list's rows when it's read, else none. */
export function listRows(model: AddModel): ImportPreviewRow[] {
  return model.tdfp.list.state === "ready" ? model.tdfp.list.rows : [];
}

/** The highlighted spool. */
export function listRow(model: AddModel): ImportPreviewRow | undefined {
  const rows = listRows(model);
  return rows[clampIndex(top(model).cursor, rows.length)];
}

function refusalNotice(row: ImportPreviewRow): string {
  return `${row.spool.shortCode} isn't imported: ${row.refusal ?? ""}`;
}

export function tdfpListKey(model: AddModel, key: KeyPress, ctx: Ctx): Result {
  if (key.name === "esc")
    return [model.stack.length > 1 ? { ...model, stack: model.stack.slice(0, -1) } : model, []];
  if (!consoleKey(ctx.values)) {
    if (key.name === "enter") return [model, [toSettings(consoleFocus(ctx.values))]];
    return [model, []];
  }
  const { list } = model.tdfp;
  if (list.state === "failed") {
    if (letter(key) === "r") return loadList(model, ctx, true);
    if (letter(key) === "s" && list.problem === "spoolease")
      return [model, [toSettings(consoleProblem(list.error).focus)]];
    return [model, []];
  }
  if (list.state !== "ready") return [model, []];
  const rows = list.rows;
  const cursor = clampIndex(top(model).cursor, rows.length);
  const row = rows[cursor];
  const { selected } = model.tdfp;
  if (key.name === "space") {
    if (!row) return [model, []];
    if (!tickable(row)) return [{ ...model, notice: refusalNotice(row) }, []];
    const next = new Set(selected);
    if (!next.delete(row.spool.shortCode)) next.add(row.spool.shortCode);
    return [
      withCursor(withTdfp(model, { selected: next }), clampIndex(cursor + 1, rows.length)),
      [],
    ];
  }
  if (isCtrl(key, "a")) {
    const codes = rows.filter(tickable).map((r) => r.spool.shortCode);
    const all = codes.length > 0 && codes.every((code) => selected.has(code));
    const next = new Set(selected);
    for (const code of codes) {
      if (all) next.delete(code);
      else next.add(code);
    }
    return [withTdfp(model, { selected: next }), []];
  }
  if (key.name === "enter") return continueList(model, ctx, row);
  if (key.name === "right") return continueList(model, ctx, undefined);
  const moved = moveCursor(cursor, key, rows.length, pageRows(ctx));
  if (moved !== null) return [withCursor(model, moved), []];
  const typedLetter = letter(key);
  if (typedLetter) {
    const typed = {
      text:
        model.typed && ctx.now - model.typed.at < TDFP_TYPE_AHEAD_MS
          ? model.typed.text + typedLetter
          : typedLetter,
      at: ctx.now,
    };
    const labels = rows.map((r) => spoolName(r.spool));
    return [withCursor({ ...model, typed }, typeAhead(labels, cursor, typed.text)), []];
  }
  return [model, []];
}

/** Letters typed within this long of each other jump together, as in Add's other lists. */
const TDFP_TYPE_AHEAD_MS = 800;

/** Leaves the list for Review with the ticked spools, or just the highlighted one when nothing is ticked. */
function continueList(
  model: AddModel,
  ctx: Ctx,
  highlighted: ImportPreviewRow | undefined,
): Result {
  let rows = tickedRows(model);
  let next = model;
  if (rows.length === 0 && highlighted) {
    if (!tickable(highlighted)) return [{ ...model, notice: refusalNotice(highlighted) }, []];
    rows = [highlighted];
    next = withTdfp(model, { selected: new Set([highlighted.spool.shortCode]) });
  }
  if (rows.length === 0)
    return [
      {
        ...model,
        notice: "Tick spools with space (ctrl+a ticks them all), or press enter on one",
      },
      [],
    ];
  return enterReview(
    next,
    ctx,
    rows.map((row) => row.spool.shortCode),
  );
}

// ── Review ──────────────────────────────────────────────────────────────────

const sameCodes = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((code, index) => code === b[index]);

/**
 * Review of these spools: what was read for the same spools and settings is shown again as it is (each read costs
 * API calls); otherwise, or with force, it's read again.
 */
export function enterReview(model: AddModel, ctx: Ctx, codes: string[], force = false): Result {
  const { review } = model.tdfp;
  const basis = planBasis(ctx.values);
  if (
    !force &&
    review &&
    review.state !== "failed" &&
    sameCodes(review.codes, codes) &&
    sameBasis(review.basis, basis)
  )
    return [{ ...model, page: "review", tdfp: { ...model.tdfp, active: true, run: null } }, []];
  const seq = model.tdfp.seq + 1;
  return [
    {
      ...model,
      page: "review",
      run: null,
      tdfp: {
        ...model.tdfp,
        seq,
        active: true,
        run: null,
        review: {
          state: "loading",
          seq,
          codes,
          prepared: null,
          plans: null,
          calls: 0,
          linkCalls: 0,
          warnings: [],
          error: "",
          problem: null,
          cursor: 0,
          basis,
          refusal: "",
        },
      },
    },
    [tdfpPrepareCmd(seq, codes, ctx.values)],
  ];
}

export type ReviewRow =
  | { kind: "item"; item: ImportItem; plan: ProfilePlan | null }
  | { kind: "refused"; code: string; reason: string; spool: TdfpSpool | null };

/** The review's rows: the spools it imports, then those it doesn't, with why. */
export function reviewRows(model: AddModel): ReviewRow[] {
  const { review, list } = model.tdfp;
  if (!review?.prepared) return [];
  const byCode = new Map(list.rows.map((row) => [row.spool.shortCode, row.spool]));
  return [
    ...review.prepared.items.map(
      (item, index): ReviewRow => ({ kind: "item", item, plan: review.plans?.[index] ?? null }),
    ),
    ...review.prepared.refused.map(
      (refusal): ReviewRow => ({
        kind: "refused",
        code: refusal.code,
        reason: refusal.reason,
        spool: byCode.get(refusal.code) ?? null,
      }),
    ),
  ];
}

export function tdfpReviewKey(model: AddModel, key: KeyPress, ctx: Ctx): Result {
  const { review } = model.tdfp;
  if (!review) return [{ ...model, page: "find" }, []];
  const fresh = withTdfp(model, { review: { ...review, refusal: "" } });
  if (key.name === "esc" || key.name === "left") return [{ ...fresh, page: "find" }, []];
  const typedLetter = letter(key);
  if (typedLetter === "a") return apply(fresh, ctx);
  if (typedLetter === "r") return enterReview(fresh, ctx, review.codes, true);
  if (typedLetter === "s") {
    const focus = importError(ctx.values)
      ? importErrorFocus(ctx.values)
      : review.problem === "spoolease"
        ? consoleProblem(review.error).focus
        : null;
    return focus ? [fresh, [toSettings(focus)]] : [fresh, []];
  }
  const count = reviewRows(fresh).length;
  const moved = moveCursor(review.cursor, key, count, pageRows(ctx));
  if (moved !== null) return [withTdfp(fresh, { review: { ...review, cursor: moved } }), []];
  return [fresh, []];
}

function apply(model: AddModel, ctx: Ctx): Result {
  // biome-ignore lint/style/noNonNullAssertion: tdfpReviewKey calls this only with a review.
  const review = model.tdfp.review!;
  if (!sameBasis(review.basis, planBasis(ctx.values))) {
    const [next, cmds] = enterReview(model, ctx, review.codes, true);
    return [
      { ...next, notice: "Settings changed since the review was read: check it again, then a" },
      cmds,
    ];
  }
  if (review.state === "loading")
    return [{ ...model, notice: "Wait for the review: it's still being read" }, []];
  if (review.state === "failed" || !review.prepared)
    return [{ ...model, notice: "The review couldn't be read: r reads it again" }, []];
  const error = importError(ctx.values);
  if (error) return [withTdfp(model, { review: { ...review, refusal: error } }), []];
  const { items } = review.prepared;
  if (items.length === 0)
    return [{ ...model, notice: "Nothing to import: none of these spools can be brought in" }, []];
  return [
    {
      ...model,
      page: "run",
      tdfp: {
        ...model.tdfp,
        run: {
          state: "running",
          items,
          stage: null,
          outcomes: [],
          warnings: [],
          error: "",
          calls: review.calls,
          wrotePresets: false,
          cursor: 0,
        },
      },
    },
    [tdfpApplyCmd(review.prepared, ctx.values)],
  ];
}

// ── Run / Done ──────────────────────────────────────────────────────────────

/** What an import changed, reloaded: presets, the console's spools and filaments, and the check. */
function reloads(): AppMsg[] {
  return [
    { type: "app/load", resource: "presets", force: true },
    { type: "app/load", resource: "console", force: true },
    { type: "app/load", resource: "check", force: true },
  ];
}

/** The outcome as a toast, only while Add is hidden: on screen, Done says it. */
function toast(ctx: Ctx, text: string, tone: "ok" | "failed"): AppMsg[] {
  return ctx.activeTab === "add" ? [] : [{ type: "app/toast", text, tone }];
}

export function importSummary(outcomes: TdfpOutcome[]): RunSummary {
  const imported = outcomes.filter((o) => o.spoolId !== null);
  const failed = outcomes.length - imported.length;
  const lines = [
    `${plural(outcomes.length, "3DFP spool")}: ${imported.length} imported${failed ? `, ${failed} failed` : ""}`,
    ...outcomes.map((o) =>
      o.spoolId
        ? `Imported ${o.code} ${o.name} → SpoolEase spool #${o.spoolId}${o.warning ? `; ${o.warning}` : ""}`
        : `Failed ${o.code} ${o.name}: ${o.error ?? "not imported"}`,
    ),
  ];
  return failed > 0 ? { ok: false, lines, exitCode: 1 } : { ok: true, lines };
}

function applied(
  model: AddModel,
  msg: Extract<TdfpMsg, { type: "add/tdfpApplied" }>,
  ctx: Ctx,
): Result {
  const { run, list } = model.tdfp;
  if (run?.state !== "running") return [model, []];
  const imported = new Set(msg.outcomes.filter((o) => o.spoolId !== null).map((o) => o.code));
  const failed = msg.outcomes.length - imported.size;
  const next = withTdfp(model, {
    run: {
      ...run,
      state: "done",
      stage: null,
      outcomes: msg.outcomes,
      warnings: [...run.warnings, ...msg.warnings],
      calls: run.calls + msg.calls,
      wrotePresets: msg.wrotePresets,
    },
    // Imported spools are linked now: off the list and out of the selection.
    list: {
      ...list,
      rows: list.rows.filter((row) => !imported.has(row.spool.shortCode)),
      linked: list.linked + imported.size,
    },
    selected: new Set([...model.tdfp.selected].filter((code) => !imported.has(code))),
    review: null,
  });
  const text =
    failed > 0
      ? `${failed} of ${plural(msg.outcomes.length, "3DFP spool")} failed`
      : `${plural(imported.size, "3DFP spool")} imported`;
  return [
    next,
    [
      send<AppMsg>(
        { type: "app/runFinished", summary: importSummary(msg.outcomes) },
        ...reloads(),
        ...toast(ctx, text, failed > 0 ? "failed" : "ok"),
      ),
    ],
  ];
}

function applyFailed(model: AddModel, error: string, exitCode: 1 | 2, ctx: Ctx): Result {
  const { run } = model.tdfp;
  if (run?.state !== "running") return [model, []];
  return [
    withTdfp(model, { run: { ...run, state: "failed", stage: null, error } }),
    [
      send<AppMsg>(
        {
          type: "app/runFinished",
          summary: { ok: false, lines: [`Importing 3DFP spools failed: ${error}`], exitCode },
        },
        ...reloads(),
        ...toast(ctx, error, "failed"),
      ),
    ],
  ];
}

/** The SpoolEase spools the run made, in order, for labels. */
export function newSpoolIds(run: TdfpRunModel): string[] {
  return run.outcomes.flatMap((o) => (o.spoolId ? [o.spoolId] : []));
}

export function tdfpRunKey(model: AddModel, key: KeyPress, ctx: Ctx): Result {
  const { run } = model.tdfp;
  if (!run || run.state === "running") return [model, []];
  const typedLetter = letter(key);
  if (run.state === "done") {
    const ids = newSpoolIds(run);
    if (typedLetter === "l" && ids.length > 0)
      return [
        model,
        [send<AppMsg>({ type: "app/openLabels", request: { spoolIds: ids, fresh: true } })],
      ];
    if (typedLetter === "s" && ids.length > 0)
      return [model, [send<AppMsg>({ type: "app/switchTab", tab: "spools", focus: ids[0] ?? "" })]];
    if (typedLetter === "n" || key.name === "enter" || key.name === "esc")
      return [{ ...model, page: "find", tdfp: { ...model.tdfp, run: null, active: false } }, []];
    const moved = moveCursor(run.cursor, key, run.outcomes.length, pageRows(ctx));
    if (moved !== null) return [withTdfp(model, { run: { ...run, cursor: moved } }), []];
    return [model, []];
  }
  if (typedLetter === "s") return [model, [toSettings(errorFocus(run.error))]];
  if (key.name === "enter" || key.name === "esc" || key.name === "left")
    return enterReview(
      model,
      ctx,
      run.items.map((item) => item.spool.shortCode),
      true,
    );
  return [model, []];
}

// ── Hints, busy ─────────────────────────────────────────────────────────────

const h = (keys: string, label: string, primary = false): Hint =>
  primary ? { keys, label, primary } : { keys, label };

export function tdfpListHints(model: AddModel, ctx: Ctx): Hint[] {
  const back = h("esc", "back", true);
  if (!consoleKey(ctx.values)) return [h("enter", "open Settings › SpoolEase", true), back];
  const { list } = model.tdfp;
  if (list.state === "failed")
    return [
      h("r", "try again", true),
      ...(list.problem === "spoolease" ? [h("s", "fix in Settings", true)] : []),
      back,
    ];
  if (list.state !== "ready" || list.rows.length === 0) return [back];
  const row = listRow(model);
  const ticks = tickedRows(model).length > 0;
  return [
    h("↑↓", "move", true),
    ...(row && tickable(row) ? [h("space", "tick", true)] : []),
    h("enter", "continue", true),
    h("ctrl+a", "tick all"),
    ...(ticks ? [h("→", "continue", true)] : []),
    back,
  ];
}

export function tdfpReviewHints(model: AddModel, ctx: Ctx): Hint[] {
  const { review } = model.tdfp;
  const fix =
    importError(ctx.values) !== "" ||
    (review?.state === "failed" && review.problem === "spoolease");
  const importable = (review?.prepared?.items.length ?? 0) > 0;
  return [
    h("↑↓", "move"),
    ...(fix ? [h("s", "fix in Settings", true)] : importable ? [h("a", "apply", true)] : []),
    h("r", "read again"),
    h("esc", "back", true),
  ];
}

export function tdfpRunHints(model: AddModel): Hint[] {
  const { run } = model.tdfp;
  if (!run || run.state === "running") return [];
  if (run.state === "failed")
    return [h("enter", "back to review", true), h("s", "fix in Settings", true)];
  const made = newSpoolIds(run).length > 0;
  return [
    ...(made ? [h("l", "labels", true), h("s", "see them in Spools", true)] : []),
    h("n", "add more", true),
  ];
}

export function tdfpBusy(model: AddModel): string | null {
  const { run } = model.tdfp;
  return run?.state === "running" ? `Importing ${plural(run.items.length, "spool")}` : null;
}
