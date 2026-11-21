// ABOUTME: The Add tab's pure update: keys per page (Find, Weights, Review, Run/Done), its own messages, and the page bar.
// ABOUTME: Also hints, capturesText and palette commands; every write goes through Review and ends in app/runFinished.

import type { Edits } from "../../../presetEdit.js";
import { applyWeights, type WeightChoice, weightGroups } from "../../../spoolWeights.js";
import { isCtrl, type KeyPress, letter, typed } from "../../core/keys.js";
import { send } from "../../core/program.js";
import type { AppMsg, Ctx, Hint, PaletteCommand, Step, TabMsg } from "../../core/types.js";
import { plural } from "../../ui/format.js";
import { moveCursor, typeAhead } from "../../ui/list.js";
import { editText } from "../../ui/textField.js";
import {
  editorCapturesText,
  editorChanges,
  editorHints,
  editorListRows,
  initEditor,
  updateEditor,
} from "../presets/index.js";
import {
  dbKey,
  type FindRow,
  importKey,
  importName,
  importSourceOf,
  levelRows,
  materialsOf,
  searchRows,
} from "./catalog.js";
import {
  ADD_MSG_TYPES,
  type AddMsg,
  addMsg,
  importCmd,
  planCmd,
  plannedPresetCmd,
  rememberWeightCmd,
  runCmd,
  weightsCmd,
} from "./cmds.js";
import { colorDialogKey, openColorDialog } from "./color.js";
import { pageArea } from "./layout.js";
import {
  type AddModel,
  dbProfiles,
  emptyPeek,
  emptyReview,
  emptyWeights,
  type FindFrame,
  findRows,
  importModel,
  PAGE_ORDER,
  type PageId,
  requestCatalog,
  rootStack,
  sourcesOf,
  ticked,
} from "./model.js";
import { forgetPeeks, peekReply, peekStep } from "./peek.js";
import { applyEvent, presetPlanText, runOutcome, spoolEasePlanText } from "./plan.js";
import {
  consoleOf,
  consoleUrl,
  createsSpools,
  errorFocus,
  planBasis,
  runError,
  runErrorFocus,
  sameBasis,
} from "./targets.js";
import { itemIndex, weightItems, weightSourceName } from "./weights.js";

type Result = Step<AddModel>;

const none = (model: AddModel): Result => [model, []];

/** Rows a pgup/pgdn moves: about a list panel's height. */
function pageRows(ctx: Ctx): number {
  return Math.max(1, ctx.bodyRows - 8);
}

function clampIndex(index: number, count: number): number {
  return Math.max(0, Math.min(index, count - 1));
}

function isAddMsg(msg: AppMsg | TabMsg): msg is AddMsg & TabMsg {
  return ADD_MSG_TYPES.has(msg.type);
}

export function update(model: AddModel, msg: AppMsg | TabMsg, ctx: Ctx): Result {
  if (msg.type === "tab") {
    const wrapped = msg as Extract<AppMsg, { type: "tab" }>;
    return wrapped.tab === "add" ? update(model, wrapped.msg, ctx) : none(model);
  }
  // The shell tells a tab each time it's shown: Add's first visit is when SpoolmanDB is needed.
  const used = msg.type === "app/switchTab" && (msg as { tab: unknown }).tab === "add";
  const [synced, syncCmds] = syncSources(model, ctx, used);
  const [next, cmds] = used
    ? shown(synced, (msg as { focus?: unknown }).focus, ctx)
    : route(synced, msg, ctx);
  // Find's detail says what adding the highlighted color does: read it once it's highlighted.
  const [peeked, peekCmds] = peekStep(next, ctx);
  return [peeked, [...syncCmds, ...cmds, ...peekCmds]];
}

/** Add is shown again: a plan read with settings changed meanwhile is read again; a deep link opens its filament. */
function shown(model: AddModel, focus: unknown, ctx: Ctx): Result {
  const [fresh, cmds] = reviewStale(model, ctx) ? reread(model, ctx) : none(model);
  if (typeof focus !== "string" || focus === "") return [fresh, cmds];
  const [focused, more] = openFocus(fresh, focus, ctx);
  return [focused, [...cmds, ...more]];
}

/**
 * What a deep link names: a bare filament ID, or "id:<filamentId>|name:<name>" (Check sends the name too,
 * for a filament SpoolmanDB may list under another ID). The name is everything after "|name:".
 */
export function parseFocus(focus: string): { id: string; name: string } {
  if (!focus.startsWith("id:")) return { id: focus.trim(), name: "" };
  const rest = focus.slice("id:".length);
  const at = rest.indexOf("|name:");
  return at < 0
    ? { id: rest.trim(), name: "" }
    : { id: rest.slice(0, at).trim(), name: rest.slice(at + "|name:".length).trim() };
}

/**
 * A deep link to a filament: Find drills to it with the cursor on it, ticked. One nothing lists by its
 * ID is searched for by its name, else Find says where to add it. While the catalog is still loading
 * the link waits in model.focus for it.
 */
function openFocus(model: AddModel, focus: string, ctx: Ctx): Result {
  if (model.run?.state === "running") return none({ ...model, focus: null });
  const { id, name } = parseFocus(focus);
  const sources = sourcesOf(model, ctx);
  const hasImport = model.imported.source !== null;
  const found = sources.db.find((p) => p.filamentId === id);
  const importAt = sources.imported.findIndex((p) => p.filamentId === id);
  if (!found && importAt < 0) {
    const waiting = ctx.resources.catalog.state !== "ready" || model.imported.state === "loading";
    if (waiting) return none({ ...model, focus });
    const base = { ...model, focus: null, page: "find" as const, run: null, dialog: null };
    if (name && searchRows(sources, name).length > 0)
      return none({
        ...base,
        search: { text: { value: name, cursor: name.length }, cursor: 0, focus: "list" },
        notice: `${id} isn't in SpoolmanDB${hasImport ? " or the import" : ""} by its ID: these match its name`,
      });
    return none({
      ...base,
      search: null,
      stack: [...rootStack(hasImport), { level: { kind: "missing", id, name }, cursor: 0 }],
    });
  }
  const key = found ? dbKey(found) : importKey(importAt);
  const selected = new Set(model.selected).add(key);
  const ticks = { ...model, selected, focus: null };
  // The editor's edits are kept only when it's left, so an open editor stays: the filament is just ticked.
  if (model.review.editing) return none(ticks);
  let stack: FindFrame[];
  if (found) {
    const brands = levelRows({ kind: "brands" }, sources, selected);
    const materials = materialsOf(sources, found.brand);
    const colors = levelRows(
      { kind: "colors", brand: found.brand, material: found.material },
      sources,
      selected,
    );
    stack = [
      ...(hasImport ? [{ level: { kind: "root" as const }, cursor: 0 }] : []),
      {
        level: { kind: "brands" },
        cursor: Math.max(
          0,
          brands.findIndex((r) => r.label === found.brand),
        ),
      },
      ...(materials.length > 1
        ? [
            {
              level: { kind: "materials" as const, brand: found.brand },
              cursor: Math.max(0, materials.indexOf(found.material)),
            },
          ]
        : []),
      {
        level: { kind: "colors", brand: found.brand, material: found.material },
        cursor: Math.max(
          0,
          colors.findIndex((r) => r.kind === "color" && r.profile === found),
        ),
      },
    ];
  } else {
    stack = [
      { level: { kind: "root" }, cursor: 1 },
      { level: { kind: "import" }, cursor: importAt },
    ];
  }
  return none({ ...ticks, page: "find", run: null, search: null, dialog: null, stack });
}

/** Follows the settings' import source, and asks for the catalog once. */
function syncSources(model: AddModel, ctx: Ctx, used: boolean): Result {
  const [requested, cmds] = used ? requestCatalog(model, ctx) : none(model);
  const wanted = importSourceOf(ctx.values);
  if (wanted === requested.imported.source) return [requested, cmds];
  const selected = new Set([...requested.selected].filter((key) => !key.startsWith("import:")));
  return [
    {
      ...requested,
      imported: importModel(wanted),
      selected,
      stack: rootStack(wanted !== null),
      search: requested.search,
    },
    [...cmds, ...(wanted === null ? [] : [importCmd(wanted)])],
  ];
}

function route(model: AddModel, msg: AppMsg | TabMsg, ctx: Ctx): Result {
  if (msg.type === "key") return keyUpdate(model, (msg as { key: KeyPress }).key, ctx);
  // The shell sends a paste only while capturesText is true: it types like a burst of keys.
  if (msg.type === "paste") {
    const text = String((msg as { text: unknown }).text ?? "");
    return keyUpdate(model, { input: text, ctrl: false, shift: false, meta: false }, ctx);
  }
  if (isAddMsg(msg)) return ownUpdate(model, msg, ctx);
  const loaded = msg.type === "app/loaded" ? (msg as { resource: unknown }).resource : null;
  if (loaded === "catalog" && model.focus !== null) return openFocus(model, model.focus, ctx);
  // Presets or the console changed (a run, the Presets or Spools tab): what's there is read again.
  if (loaded === "presets" || loaded === "console") return none(forgetPeeks(model));
  return none(model);
}

function ownUpdate(model: AddModel, msg: AddMsg, ctx: Ctx): Result {
  switch (msg.type) {
    case "add/imported": {
      if (msg.source !== model.imported.source) return none(model);
      const selected = new Set(model.selected);
      for (const index of msg.profiles.keys()) selected.add(importKey(index));
      return none({
        ...model,
        imported: { source: msg.source, state: "ready", profiles: msg.profiles, error: "" },
        selected,
      });
    }
    case "add/importFailed":
      if (msg.source !== model.imported.source) return none(model);
      return none({
        ...model,
        imported: { source: msg.source, state: "failed", profiles: [], error: msg.error },
      });
    case "add/weightsRead":
      return weightsRead(model, msg, ctx);
    case "add/weightsFailed":
      if (msg.signature !== model.weights.signature) return none(model);
      return none({
        ...model,
        weights: {
          ...model.weights,
          state: "failed",
          error: msg.error,
          keyRejected: msg.keyRejected,
        },
      });
    case "add/planRead":
      if (msg.seq !== model.review.seq) return none(model);
      return none({
        ...model,
        review: {
          ...model.review,
          state: "ready",
          plans: msg.plans,
          warnings: msg.warnings,
          cursor: clampIndex(model.review.cursor, model.review.profiles.length),
        },
      });
    case "add/peekConsole":
    case "add/peeked":
      return none(peekReply(model, msg));
    case "add/plannedPreset":
      if (msg.seq !== model.review.seq || model.page !== "review") return none(model);
      return none({
        ...model,
        review: {
          ...model.review,
          editing: {
            filamentId: msg.filamentId,
            editor: initEditor({
              name: msg.name,
              printer: msg.printer,
              path: msg.path,
              original: msg.original,
              ...(model.planEdits.has(msg.filamentId)
                ? { edits: model.planEdits.get(msg.filamentId) as Edits }
                : {}),
              mode: "planned",
            }),
          },
        },
      });
    case "add/plannedPresetFailed":
      if (msg.seq !== model.review.seq) return none(model);
      return none({ ...model, review: { ...model.review, error: msg.error } });
    case "add/runEvent":
      return none(runEvent(model, msg.event));
    case "add/runDone":
      return runDone(model, msg.results, ctx);
    case "add/runFailed":
      return runFailed(model, msg.error, msg.exitCode, ctx);
    case "add/planEdits": {
      const edits = new Map(model.planEdits);
      if (msg.edits.size > 0) edits.set(msg.filamentId, msg.edits);
      else edits.delete(msg.filamentId);
      // Edits from elsewhere come without their before and after: the note counts them instead.
      const changes = new Map(model.planChanges);
      changes.delete(msg.filamentId);
      const next = forgetPeeks({ ...model, planEdits: edits, planChanges: changes });
      return next.page === "review" ? enterReview(next, ctx) : none(next);
    }
    case "add/openSearch": {
      if (model.run?.state === "running") return none(model);
      const [opened] = openSearch({ ...model, page: "find", run: null }, "query");
      return [opened, [send<AppMsg>({ type: "app/switchTab", tab: "add" })]];
    }
    case "add/review": {
      if (model.run?.state === "running") return none(model);
      const [next, cmds] = continueFind({ ...model, page: "find", run: null }, ctx, undefined);
      return [next, [send<AppMsg>({ type: "app/switchTab", tab: "add" }), ...cmds]];
    }
    case "add/clear":
      return none({ ...model, selected: new Set() });
  }
}

function keyUpdate(model: AddModel, key: KeyPress, ctx: Ctx): Result {
  const fresh = {
    ...model,
    notice: "",
    review: { ...model.review, error: "" },
    // Type-ahead gathers letters typed in a row; any other key starts it over.
    typed: letter(key) ? model.typed : null,
  };
  switch (fresh.page) {
    case "find":
      return findKey(fresh, key, ctx);
    case "weights":
      return weightsKey(fresh, key, ctx);
    case "review":
      return reviewKey(fresh, key, ctx);
    case "run":
      return runKey(fresh, key, ctx);
  }
}

// ── Find ────────────────────────────────────────────────────────────────────

const BRANDS: FindFrame = { level: { kind: "brands" }, cursor: 0 };

function top(model: AddModel): FindFrame {
  return model.stack.at(-1) ?? BRANDS;
}

function withTop(model: AddModel, changes: Partial<FindFrame>): AddModel {
  return { ...model, stack: [...model.stack.slice(0, -1), { ...top(model), ...changes }] };
}

function toggle(selected: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(selected);
  if (!next.delete(key)) next.add(key);
  return next;
}

/** Ticks every color of rows, or unticks them all when they're all ticked. */
function toggleAll(selected: ReadonlySet<string>, rows: FindRow[]): ReadonlySet<string> {
  const keys = rows.flatMap((r) => (r.kind === "color" ? [r.key] : []));
  const next = new Set(selected);
  const all = keys.length > 0 && keys.every((k) => next.has(k));
  for (const k of keys) {
    if (all) next.delete(k);
    else next.add(k);
  }
  return next;
}

function openSearch(model: AddModel, focus: "query" | "list"): Result {
  return none({
    ...model,
    search: { text: { value: "", cursor: 0 }, cursor: 0, focus },
  });
}

/** The rows Find shows now: the search results or the top level's. */
export { findRows };

function findKey(model: AddModel, key: KeyPress, ctx: Ctx): Result {
  if (model.dialog) return dialogKey(model, key, ctx);
  if (model.search) return searchKey(model, key, ctx);
  return drillKey(model, key, ctx);
}

function drillKey(model: AddModel, key: KeyPress, ctx: Ctx): Result {
  const frame = top(model);
  const sources = sourcesOf(model, ctx);
  const rows = levelRows(frame.level, sources, model.selected);
  const cursor = clampIndex(frame.cursor, rows.length);
  const row = rows[cursor];

  if (key.name === "esc") {
    return model.stack.length > 1
      ? none({ ...model, stack: model.stack.slice(0, -1) })
      : none(model);
  }
  const { level } = frame;
  if (level.kind === "missing") {
    if (key.name === "enter") return [model, [toSettings("import.source")]];
    if (typed(key) === "/") {
      const [searching] = openSearch(model, "query");
      const value = level.name;
      return none({
        ...searching,
        search: { text: { value, cursor: value.length }, cursor: 0, focus: "query" },
      });
    }
    return none(model);
  }
  if (key.name === "enter") {
    if (!row) return none(model);
    switch (row.kind) {
      case "source":
        return push(model, row.source === "db" ? { kind: "brands" } : { kind: "import" });
      case "brand": {
        const materials = materialsOf(sources, row.label);
        const [only] = materials;
        return push(
          model,
          materials.length === 1 && only
            ? { kind: "colors", brand: row.label, material: only }
            : { kind: "materials", brand: row.label },
        );
      }
      case "material":
        return frame.level.kind === "materials"
          ? push(model, { kind: "colors", brand: frame.level.brand, material: row.label })
          : none(model);
      case "color":
        return continueFind(model, ctx, row.key);
      case "other": {
        if (frame.level.kind !== "colors") return none(model);
        const colors = rows.flatMap((r) => (r.kind === "color" ? [r] : []));
        const tickedOne = colors.find((r) => model.selected.has(r.key));
        return none({
          ...model,
          dialog: openColorDialog(
            frame.level.brand,
            frame.level.material,
            colors.map((r) => r.profile),
            tickedOne?.profile,
          ),
        });
      }
    }
  }
  if (key.name === "space") {
    if (row?.kind !== "color") return none(model);
    return none(
      withTop(
        { ...model, selected: toggle(model.selected, row.key) },
        { cursor: clampIndex(cursor + 1, rows.length) },
      ),
    );
  }
  if (isCtrl(key, "a")) return none({ ...model, selected: toggleAll(model.selected, rows) });
  if (key.name === "right") return continueFind(model, ctx, undefined);
  if (typed(key) === "/") return openSearch(model, "query");
  if (
    letter(key) === "r" &&
    ctx.resources.catalog.state === "failed" &&
    frame.level.kind !== "import"
  )
    return [model, [send<AppMsg>({ type: "app/load", resource: "catalog", force: true })]];
  const moved = moveCursor(cursor, key, rows.length, pageRows(ctx));
  if (moved !== null) return none(withTop(model, { cursor: moved }));
  const typedLetter = letter(key);
  if (typedLetter) {
    const typed = typedText(model, typedLetter, ctx);
    return none(
      withTop(
        { ...model, typed },
        {
          cursor: typeAhead(
            rows.map((r) => r.label),
            cursor,
            typed.text,
          ),
        },
      ),
    );
  }
  return none(model);
}

/** Letters typed within this long of each other jump together ("3dh" → 3DHoJor). */
export const TYPE_AHEAD_MS = 800;

function typedText(model: AddModel, typedLetter: string, ctx: Ctx): { text: string; at: number } {
  const { typed } = model;
  const text = typed && ctx.now - typed.at < TYPE_AHEAD_MS ? typed.text + typedLetter : typedLetter;
  return { text, at: ctx.now };
}

function push(model: AddModel, level: FindFrame["level"]): Result {
  return none({ ...model, stack: [...model.stack, { level, cursor: 0 }] });
}

function searchKey(model: AddModel, key: KeyPress, ctx: Ctx): Result {
  // biome-ignore lint/style/noNonNullAssertion: findKey routes here only with a search open.
  const search = model.search!;
  const rows = searchRows(sourcesOf(model, ctx), search.text.value);
  const cursor = clampIndex(search.cursor, rows.length);
  const withSearch = (changes: Partial<typeof search>): AddModel => ({
    ...model,
    search: { ...search, cursor, ...changes },
  });

  if (key.name === "esc") return none({ ...model, search: null });
  if (isCtrl(key, "a")) return none({ ...model, selected: toggleAll(model.selected, rows) });

  if (search.focus === "query") {
    if (key.name === "enter" || key.name === "down")
      return none(rows.length > 0 ? withSearch({ focus: "list" }) : model);
    const edited = editText(search.text, key);
    if (edited) {
      // A paste ending in enter searches and goes to the results, as typing then enter does,
      // when the edited query has any.
      const text = { value: edited.value, cursor: edited.cursor };
      const found = edited.submit && searchRows(sourcesOf(model, ctx), text.value).length > 0;
      const focus = found ? "list" : "query";
      return none(withSearch({ text, cursor: 0, focus }));
    }
    return none(model);
  }

  const row = rows[cursor];
  if (key.name === "up" && cursor === 0) return none(withSearch({ focus: "query" }));
  if (typed(key) === "/") return none(withSearch({ focus: "query" }));
  if (key.name === "space") {
    if (row?.kind !== "color") return none(model);
    return none({
      ...withSearch({ cursor: clampIndex(cursor + 1, rows.length) }),
      selected: toggle(model.selected, row.key),
    });
  }
  if (key.name === "enter")
    return continueFind(model, ctx, row?.kind === "color" ? row.key : undefined);
  if (key.name === "right") return continueFind(model, ctx, undefined);
  const moved = moveCursor(cursor, key, rows.length, pageRows(ctx));
  if (moved !== null) return none(withSearch({ cursor: moved }));
  return none(model);
}

function dialogKey(model: AddModel, key: KeyPress, ctx: Ctx): Result {
  // biome-ignore lint/style/noNonNullAssertion: findKey routes here only with a dialog open.
  const dialog = model.dialog!;
  const result = colorDialogKey(dialog, key, dbProfiles(model, ctx));
  if ("dialog" in result) return none({ ...model, dialog: result.dialog });
  if ("close" in result) return none({ ...model, dialog: null });
  // The new color joins the session's catalog, ticked, with the cursor on it, like any listed color.
  const added = {
    ...model,
    dialog: null,
    extra: [...model.extra, result.added],
    selected: new Set(model.selected).add(dbKey(result.added)),
  };
  const rows = levelRows(top(added).level, sourcesOf(added, ctx), added.selected);
  const cursor = rows.findIndex((r) => r.kind === "color" && r.profile === result.added);
  return none(withTop(added, { cursor: Math.max(0, cursor) }));
}

/** Leaves Find with the ticked profiles, or just the highlighted one when nothing is ticked. */
function continueFind(model: AddModel, ctx: Ctx, highlighted: string | undefined): Result {
  const selected =
    model.selected.size === 0 && highlighted ? new Set([highlighted]) : model.selected;
  const next = { ...model, selected };
  if (ticked(next, ctx).length === 0 && model.imported.state === "loading")
    return none({
      ...next,
      notice: `Still reading ${importName(model.imported.source ?? "")}: try again in a moment`,
    });
  if (ticked(next, ctx).length === 0)
    return none({
      ...next,
      notice: "Tick filaments with space (ctrl+a ticks a whole list), or press enter on one",
    });
  return createsSpools(ctx.values) ? enterWeights(next, ctx) : enterReview(next, ctx);
}

// ── Weights ─────────────────────────────────────────────────────────────────

function weightsSignature(model: AddModel, ctx: Ctx): string {
  const connection = consoleOf(ctx.values);
  const keys = ticked(model, ctx).map((e) => e.key);
  return `${keys.join(",")}|${connection ? consoleUrl(connection) : ""}`;
}

function enterWeights(model: AddModel, ctx: Ctx): Result {
  const signature = weightsSignature(model, ctx);
  const { weights } = model;
  if (weights.signature === signature && weights.state === "ready")
    return weights.prompts.length === 0
      ? enterReview(model, ctx)
      : none({ ...model, page: "weights" });
  if (weights.signature === signature && weights.state === "loading")
    return none({ ...model, page: "weights" });
  const entries = ticked(model, ctx);
  return [
    {
      ...model,
      page: "weights",
      weights: {
        ...emptyWeights(),
        state: "loading",
        signature,
        profiles: entries.map((e) => e.profile),
        origins: entries.map((e) => e.origin),
      },
    },
    [weightsCmd(signature, ctx.values)],
  ];
}

function itemsFor(model: AddModel, step: number) {
  const { weights } = model;
  const group = weights.prompts[step];
  if (!group) return [];
  const origins = group.profiles.flatMap((i) => {
    const origin = weights.origins[i];
    return origin ? [origin] : [];
  });
  const importName = sourcesOfImport(model);
  return weightItems(group, weights.profiles, weightSourceName(origins, importName));
}

function sourcesOfImport(model: AddModel): string | null {
  const source = model.imported.source;
  return source === null ? null : importName(source);
}

/** The weight items for the brand being chosen, for the view. */
export function currentWeightItems(model: AddModel) {
  return itemsFor(model, model.weights.step);
}

/** The cursor on a brand's items: this run's choice, else the session's last one for the brand, else the source's. */
function cursorFor(model: AddModel, step: number): number {
  const group = model.weights.prompts[step];
  const choice = group && (model.weightChoices.get(group.key) ?? model.weightMemory.get(group.key));
  return itemIndex(itemsFor(model, step), choice);
}

/** The brand's marked (●) choice: what → takes, the one the cursor starts on. */
export function markedChoice(model: AddModel, step = model.weights.step): WeightChoice | null {
  return itemsFor(model, step)[cursorFor(model, step)]?.choice ?? null;
}

function toSettings(focus: string | null): ReturnType<typeof send<AppMsg>> {
  return send<AppMsg>({
    type: "app/switchTab",
    tab: "settings",
    ...(focus === null ? {} : { focus }),
  });
}

function weightsRead(
  model: AddModel,
  msg: Extract<AddMsg, { type: "add/weightsRead" }>,
  ctx: Ctx,
): Result {
  if (msg.signature !== model.weights.signature) return none(model);
  const groups = weightGroups(model.weights.profiles, msg.entries);
  const spooled = new Set(msg.spooled);
  // This session's choices win over those remembered from earlier ones.
  const weightMemory = new Map([...Object.entries(msg.remembered), ...model.weightMemory]);
  // A brand whose filaments all have spools on the console gets no new spool, so no weight is asked.
  const makesSpool = (g: (typeof groups)[number]) =>
    g.profiles.some((i) => !spooled.has(model.weights.profiles[i]?.filamentId ?? ""));
  const prompts = groups.filter((g) => g.options.length !== 1 && makesSpool(g));
  const read: AddModel = {
    ...model,
    weightMemory,
    weights: {
      ...model.weights,
      state: "ready",
      groups,
      prompts,
      warnings: msg.warnings,
      step: 0,
      cursor: 0,
      error: "",
      keyRejected: false,
      spooled,
    },
  };
  const next = { ...read, weights: { ...read.weights, cursor: cursorFor(read, 0) } };
  return prompts.length === 0 && next.page === "weights" ? enterReview(next, ctx) : none(next);
}

function weightsKey(model: AddModel, key: KeyPress, ctx: Ctx): Result {
  const { weights } = model;
  const back = key.name === "esc" || key.name === "left";
  if (weights.state !== "ready") {
    if (back) return none({ ...model, page: "find" });
    if (weights.state === "failed" && letter(key) === "r")
      return enterWeights({ ...model, weights: emptyWeights() }, ctx);
    if (weights.state === "failed" && weights.keyRejected && letter(key) === "s")
      return [model, [toSettings(errorFocus(weights.error))]];
    return none(model);
  }
  const items = itemsFor(model, weights.step);
  const at = (step: number, changes = {}): AddModel => ({
    ...model,
    ...changes,
    weights: { ...weights, step, cursor: cursorFor({ ...model, ...changes }, step) },
  });

  if (back) return none(weights.step > 0 ? at(weights.step - 1) : { ...model, page: "find" });
  // enter chooses the highlighted row; → takes the marked one (●): both go on to the next brand.
  const choose = (choice: WeightChoice | null | undefined): Result => {
    const group = weights.prompts[weights.step];
    if (!group || !choice) return none(model);
    const weightChoices = new Map(model.weightChoices).set(group.key, choice);
    const weightMemory = new Map(model.weightMemory).set(group.key, choice);
    const next = { ...model, weightChoices, weightMemory };
    const remember = rememberWeightCmd(group.key, group.brand, choice);
    if (weights.step + 1 < weights.prompts.length)
      return [at(weights.step + 1, { weightChoices, weightMemory }), [remember]];
    const [reviewed, cmds] = enterReview(next, ctx);
    return [reviewed, [remember, ...cmds]];
  };
  if (key.name === "enter") return choose(items[weights.cursor]?.choice);
  if (key.name === "right") return choose(markedChoice(model));
  const moved = moveCursor(weights.cursor, key, items.length, pageRows(ctx));
  if (moved !== null) return none({ ...model, weights: { ...weights, cursor: moved } });
  const typedLetter = letter(key);
  if (typedLetter)
    return none({
      ...model,
      weights: {
        ...weights,
        cursor: typeAhead(
          items.map((i) => i.label),
          weights.cursor,
          typedLetter,
        ),
      },
    });
  return none(model);
}

/** Whether the Weights page applies to this selection: spools are created and some brand needs a choice. */
export function weightsNeeded(model: AddModel, ctx: Ctx): boolean | null {
  if (!createsSpools(ctx.values)) return false;
  const { weights } = model;
  if (weights.signature !== weightsSignature(model, ctx) || weights.state !== "ready") return null;
  return weights.prompts.length > 0;
}

// ── Review ──────────────────────────────────────────────────────────────────

function enterReview(model: AddModel, ctx: Ctx): Result {
  const entries = ticked(model, ctx);
  if (entries.length === 0)
    return none({ ...model, page: "find", notice: "Tick filaments with space first" });
  const { weights } = model;
  const weighted =
    createsSpools(ctx.values) &&
    weights.state === "ready" &&
    weights.signature === weightsSignature(model, ctx);
  const profiles = weighted
    ? applyWeights(weights.profiles, weights.groups, model.weightChoices)
    : entries.map((e) => e.profile);
  const seq = model.review.seq + 1;
  return [
    {
      ...model,
      page: "review",
      review: {
        ...emptyReview(seq),
        state: "loading",
        profiles,
        cursor: clampIndex(model.review.cursor, profiles.length),
        basis: planBasis(ctx.values),
      },
    },
    [planCmd(seq, profiles, ctx.values, model.planEdits)],
  ];
}

/** The review's plan was read with other settings than the session's now (changed in Settings meanwhile). */
function reviewStale(model: AddModel, ctx: Ctx): boolean {
  const { review } = model;
  return (
    model.page === "review" &&
    review.editing === null &&
    review.basis !== null &&
    !sameBasis(review.basis, planBasis(ctx.values))
  );
}

/** Reads the plan again for the session's settings, through Weights when those now need a choice. */
function reread(model: AddModel, ctx: Ctx): Result {
  const { weights } = model;
  const weighed =
    !createsSpools(ctx.values) ||
    (weights.state === "ready" &&
      weights.signature === weightsSignature(model, ctx) &&
      weights.prompts.every((g) => model.weightChoices.has(g.key)));
  return weighed ? enterReview(model, ctx) : enterWeights(model, ctx);
}

/**
 * The plan would change nothing: every preset is kept and SpoolEase already has every row and spool
 * (or is skipped). Unknown when SpoolEase couldn't be read, so a run is still offered then.
 */
export function nothingToApply(model: AddModel, ctx: Ctx): boolean {
  const { review } = model;
  if (review.state !== "ready" || !review.plans || review.plans.length === 0) return false;
  const withConsole = consoleOf(ctx.values) !== null;
  return review.plans.every((plan) => {
    if (presetPlanText(plan, ctx.values.overwritePresets).tone !== "same") return false;
    const spoolease = spoolEasePlanText(plan);
    return spoolease ? spoolease.tone === "same" : !withConsole;
  });
}

function sourceLabel(model: AddModel, ctx: Ctx): string {
  return weightSourceName(
    ticked(model, ctx).map((e) => e.origin),
    sourcesOfImport(model),
  );
}

function reviewKey(model: AddModel, key: KeyPress, ctx: Ctx): Result {
  const { review } = model;
  if (review.editing) return editorKey(model, key, ctx);
  if (key.name === "esc" || key.name === "left") {
    if (weightsNeeded(model, ctx)) {
      const last = model.weights.prompts.length - 1;
      return none({
        ...model,
        page: "weights",
        weights: { ...model.weights, step: last, cursor: cursorFor(model, last) },
      });
    }
    return none({ ...model, page: "find" });
  }
  const typedLetter = letter(key);
  if (typedLetter === "a") return apply(model, ctx);
  if (typedLetter === "s" && runError(ctx.values))
    return [model, [toSettings(runErrorFocus(ctx.values))]];
  if (typedLetter === "r") return enterReview(model, ctx);
  if (typedLetter === "e") return openPlanEdit(model, ctx);
  const moved = moveCursor(review.cursor, key, review.profiles.length, pageRows(ctx));
  if (moved !== null) return none({ ...model, review: { ...review, cursor: moved } });
  return none(model);
}

/** e: the highlighted row's preset, as the run would write it, opens in the Presets tab's editor. */
function openPlanEdit(model: AddModel, ctx: Ctx): Result {
  const { review } = model;
  const profile = review.profiles[review.cursor];
  if (review.state !== "ready" || !profile)
    return none({ ...model, notice: "Wait for the plan: it's still being read" });
  return [model, [plannedPresetCmd(review.seq, profile, ctx.values)]];
}

/** Keys while the editor is open: it takes them all; leaving keeps its edits for the run. */
function editorKey(model: AddModel, key: KeyPress, ctx: Ctx): Result {
  const { editing } = model.review;
  if (!editing) return none(model);
  const step = updateEditor(
    editing.editor,
    key,
    editorListRows(pageArea(ctx.bodyColumns, ctx.bodyRows).height),
  );
  if (step.outcome?.type === "leave") {
    const edits = new Map(model.planEdits);
    const changes = new Map(model.planChanges);
    const made = editorChanges(step.model);
    if (step.outcome.edits.size > 0) {
      edits.set(editing.filamentId, step.outcome.edits);
      changes.set(editing.filamentId, made);
    } else {
      edits.delete(editing.filamentId);
      changes.delete(editing.filamentId);
    }
    return enterReview(
      forgetPeeks({
        ...model,
        planEdits: edits,
        planChanges: changes,
        review: { ...model.review, editing: null },
      }),
      ctx,
    );
  }
  return none({
    ...model,
    review: { ...model.review, editing: { ...editing, editor: step.model } },
  });
}

function apply(model: AddModel, ctx: Ctx): Result {
  const { review } = model;
  if (reviewStale(model, ctx)) {
    const [next, cmds] = reread(model, ctx);
    return [
      { ...next, notice: "Settings changed since the plan was read: check it again, then a" },
      cmds,
    ];
  }
  if (review.state !== "ready")
    return none({ ...model, notice: "Wait for the plan: it's still being read" });
  const error = runError(ctx.values);
  if (error) return none({ ...model, review: { ...review, error } });
  if (nothingToApply(model, ctx))
    return none({ ...model, notice: "Nothing to apply: everything is there already" });
  return [
    {
      ...model,
      page: "run",
      run: {
        state: "running",
        profiles: review.profiles,
        plans: review.plans,
        progress: [],
        stage: null,
        warnings: [...(createsSpools(ctx.values) ? model.weights.warnings : [])],
        results: [],
        error: "",
        spoolIds: [],
        sourceLabel: sourceLabel(model, ctx),
      },
    },
    [runCmd(review.profiles, ctx.values, model.planEdits)],
  ];
}

// ── Run / Done ──────────────────────────────────────────────────────────────

function runEvent(model: AddModel, event: Extract<AddMsg, { type: "add/runEvent" }>["event"]) {
  const { run } = model;
  if (run?.state !== "running") return model;
  if (event.type === "stage") return { ...model, run: { ...run, stage: event.stage } };
  if (event.type === "warning")
    return { ...model, run: { ...run, warnings: [...run.warnings, event.message] } };
  return { ...model, run: { ...run, progress: applyEvent(run.progress, event) } };
}

/** The resources a run changed, reloaded: presets always, the console and the check when it wrote there. */
function reloads(ctx: Ctx): AppMsg[] {
  const msgs: AppMsg[] = [{ type: "app/load", resource: "presets", force: true }];
  if (consoleOf(ctx.values))
    msgs.push(
      { type: "app/load", resource: "console", force: true },
      { type: "app/load", resource: "check", force: true },
    );
  return msgs;
}

/** The run's outcome as a toast, only while Add is hidden: on screen, its Done or Failed card says it. */
function runToast(ctx: Ctx, text: string, tone: "ok" | "failed"): AppMsg[] {
  return ctx.activeTab === "add" ? [] : [{ type: "app/toast", text, tone }];
}

function runDone(model: AddModel, results: Parameters<typeof runOutcome>[0], ctx: Ctx): Result {
  const { run } = model;
  if (run?.state !== "running") return none(model);
  const outcome = runOutcome(results, run.sourceLabel);
  // The run is done with the selection, the weights and the edits: the next one starts fresh.
  return [
    {
      ...model,
      run: { ...run, state: "done", stage: null, results, spoolIds: outcome.spoolIds },
      selected: new Set(),
      weights: emptyWeights(),
      weightChoices: new Map(),
      planEdits: new Map(),
      planChanges: new Map(),
      review: emptyReview(model.review.seq),
      peek: emptyPeek(),
    },
    [
      send<AppMsg>(
        { type: "app/runFinished", summary: outcome.summary },
        ...reloads(ctx),
        ...runToast(ctx, outcome.toast.text, outcome.toast.tone),
      ),
    ],
  ];
}

function runFailed(model: AddModel, error: string, exitCode: 1 | 2, ctx: Ctx): Result {
  const { run } = model;
  if (run?.state !== "running") return none(model);
  // Nothing was finished, so the selection stays for another try once the cause is fixed.
  return [
    { ...model, run: { ...run, state: "failed", stage: null, error } },
    [
      send<AppMsg>(
        {
          type: "app/runFinished",
          summary: { ok: false, lines: [`Adding filaments failed: ${error}`], exitCode },
        },
        ...reloads(ctx),
        ...runToast(ctx, error, "failed"),
      ),
    ],
  ];
}

function startOver(model: AddModel): AddModel {
  return {
    ...model,
    page: "find",
    run: null,
    search: null,
    stack: rootStack(model.imported.source !== null),
  };
}

function runKey(model: AddModel, key: KeyPress, ctx: Ctx): Result {
  const { run } = model;
  if (!run || run.state === "running") return none(model);
  const typedLetter = letter(key);
  if (run.state === "done") {
    if (typedLetter === "l" && run.spoolIds.length > 0)
      return [
        model,
        [
          send<AppMsg>({
            type: "app/openLabels",
            request: { spoolIds: run.spoolIds, fresh: true },
          }),
        ],
      ];
    if (typedLetter === "s" && run.spoolIds.length > 0)
      return [
        model,
        [send<AppMsg>({ type: "app/switchTab", tab: "spools", focus: run.spoolIds[0] ?? "" })],
      ];
    if (typedLetter === "n" || key.name === "enter" || key.name === "esc")
      return none(startOver(model));
    return none(model);
  }
  if (typedLetter === "s") return [model, [toSettings(errorFocus(run.error))]];
  if (key.name === "enter" || key.name === "esc" || key.name === "left")
    return enterReview({ ...model, run: null }, ctx);
  return none(model);
}

// ── Pages, hints, text capture, palette ─────────────────────────────────────

export type PageState = "done" | "current" | "todo" | "disabled";

export interface PageTab {
  id: PageId;
  title: string;
  state: PageState;
  badge?: string;
}

const PAGE_TITLES: Record<PageId, string> = {
  find: "Find",
  weights: "Weights",
  review: "Review",
  run: "Done",
};

export function pageBar(model: AddModel, ctx: Ctx): PageTab[] {
  const current = PAGE_ORDER.indexOf(model.page);
  const count = ticked(model, ctx).length;
  return PAGE_ORDER.map((id, index): PageTab => {
    const state: PageState =
      id === "weights" && weightsNeeded(model, ctx) === false
        ? "disabled"
        : index < current
          ? "done"
          : index === current
            ? "current"
            : "todo";
    const title = PAGE_TITLES[id];
    return id === "find" && count > 0
      ? { id, title, state, badge: String(count) }
      : { id, title, state };
  });
}

const h = (keys: string, label: string, primary = false): Hint =>
  primary ? { keys, label, primary } : { keys, label };

export function hints(model: AddModel, ctx: Ctx): Hint[] {
  switch (model.page) {
    case "find":
      return findHints(model, ctx);
    case "weights": {
      const { weights } = model;
      if (weights.state === "failed")
        return [
          h("r", "try again", true),
          ...(weights.keyRejected ? [h("s", "fix in Settings", true)] : []),
          h("esc", "back"),
        ];
      if (weights.state !== "ready") return [h("esc", "back")];
      return [
        h("↑↓", "move", true),
        h("enter", "choose", true),
        h("→", "use ●"),
        h("esc", "back", true),
      ];
    }
    case "review": {
      if (model.review.editing)
        // Leaving the embedded editor keeps its edits for the run: the footer says so, once.
        return editorHints(model.review.editing.editor).map((hint) =>
          hint.keys === "esc" && hint.label === "back"
            ? { ...hint, label: "back (keeps edits)" }
            : hint,
        );
      const fix = runError(ctx.values);
      return [
        h("↑↓", "move"),
        h("e", "edit its preset", true),
        ...(fix
          ? [h("s", "fix in Settings", true)]
          : nothingToApply(model, ctx)
            ? []
            : [h("a", "apply", true)]),
        h("r", "read again"),
        h("esc", "back", true),
      ];
    }
    case "run": {
      const { run } = model;
      if (!run || run.state === "running") return [];
      if (run.state === "failed")
        return [h("enter", "back to review", true), h("s", "fix in Settings", true)];
      return [
        ...(run.spoolIds.length > 0
          ? [h("l", "labels", true), h("s", "see them in Spools", true)]
          : []),
        h("n", "add more", true),
      ];
    }
  }
}

function findHints(model: AddModel, ctx: Ctx): Hint[] {
  if (model.dialog) {
    const field = model.dialog.field;
    return [
      h("↑↓", "field", true),
      ...(field === "base" ? [h("←→", "listed color", true)] : []),
      ...(field === "add" ? [h("enter", "add color", true)] : [h("enter", "next", true)]),
      h("tab", "next field"),
      h("esc", "cancel", true),
    ];
  }
  const hasTicks = ticked(model, ctx).length > 0;
  if (model.search) {
    if (model.search.focus === "query")
      return [
        h("type", "search", true),
        h("↓", "results", true),
        h("ctrl+a", "tick all"),
        h("esc", "close search", true),
      ];
    return [
      h("↑↓", "move", true),
      h("space", "tick", true),
      h("enter", "continue", true),
      h("ctrl+a", "tick all"),
      h("/", "edit search"),
      h("esc", "close search", true),
    ];
  }
  if (top(model).level.kind === "missing")
    return [
      h("enter", "open Settings › Import", true),
      h("/", "search", true),
      h("esc", "back", true),
    ];
  const rows = findRows(model, ctx);
  const row = rows[clampIndex(top(model).cursor, rows.length)];
  const isList = top(model).level.kind === "colors" || top(model).level.kind === "import";
  return [
    h("↑↓", "move", true),
    ...(row?.kind === "color"
      ? [h("space", "tick", true), h("enter", "continue", true)]
      : row
        ? [h("enter", row.kind === "other" ? "add a color" : "open", true)]
        : []),
    ...(isList ? [h("ctrl+a", "tick all")] : []),
    h("/", "search", true),
    ...(hasTicks && row?.kind !== "color" ? [h("→", "continue", true)] : []),
    ...(model.stack.length > 1 ? [h("esc", "back", true)] : []),
    ...(ctx.resources.catalog.state === "failed" ? [h("r", "load SpoolmanDB again")] : []),
  ];
}

/** True while the search query or a dialog has the keys, so q, ? and letters type there. */
export function capturesText(model: AddModel): boolean {
  if (model.page === "review" && model.review.editing)
    return editorCapturesText(model.review.editing.editor);
  if (model.page !== "find") return false;
  // A dialog takes every key while open, so q never quits from it.
  if (model.dialog) return true;
  return model.search?.focus === "query";
}

/** What a run is writing, while it runs: the shell won't quit on q meanwhile. */
export function busy(model: AddModel): string | null {
  const { run } = model;
  return run?.state === "running" ? `Adding ${plural(run.profiles.length, "filament")}` : null;
}

/** The plan edits a quit would drop: those kept for the run, and those in the open editor. */
export function unsaved(model: AddModel): number {
  const { editing } = model.review;
  let count = 0;
  for (const [id, edits] of model.planEdits) if (id !== editing?.filamentId) count += edits.size;
  return count + (editing ? editorChanges(editing.editor).length : 0);
}

/** The Other color dialog is open: it takes q and tab too. */
export function modal(model: AddModel): boolean {
  return model.page === "find" && model.dialog !== null;
}

export function commands(model: AddModel, ctx: Ctx): PaletteCommand[] {
  const count = ticked(model, ctx).length;
  return [
    {
      title: "Search SpoolmanDB",
      detail: "Add",
      keys: "/",
      msg: addMsg({ type: "add/openSearch" }),
    },
    ...(count > 0
      ? [
          {
            title: `Review the ${count} ticked`,
            detail: "Add",
            keys: "→",
            msg: addMsg({ type: "add/review" }),
          },
          { title: "Untick everything", detail: "Add", msg: addMsg({ type: "add/clear" }) },
        ]
      : []),
  ];
}
