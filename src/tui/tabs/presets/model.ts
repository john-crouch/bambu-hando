// ABOUTME: The Presets tab's model and pure update: the preset list with its detail, the editor, drafts and the review.
// ABOUTME: Keys and the tab's own messages come in, the next model and commands (file reads, saves) go out.

import {
  applyEdits,
  type EditChange,
  type EditResult,
  type Edits,
  editChanges,
  nozzleRange,
  type Preset,
  presetFamily,
} from "../../../presetEdit.js";
import type { UserPreset } from "../../../syncCheck.js";
import { type KeyPress, letter, typed } from "../../core/keys.js";
import { type Cmd, send } from "../../core/program.js";
import {
  type AppMsg,
  type Ctx,
  type Hint,
  type PaletteCommand,
  type PresetsData,
  type Resource,
  type StartOptions,
  type Step,
  type TabMsg,
  toTab,
} from "../../core/types.js";
import { editText, moveCursor, type TextState, typeAhead } from "../../ui/index.js";
import {
  type PresetFileMsg,
  type RangeMsg,
  type RangeState,
  rangeCmd,
  readPresetCmd,
  type SavedMsg,
  type SpoolEaseOutcome,
  saveCmd,
  spooleaseConnection,
} from "./cmds.js";
import { presetRows, presetTitle } from "./detail.js";
import {
  type EditorModel,
  editorCapturesText,
  editorHints,
  initEditor,
  updateEditor,
} from "./editor.js";

/** A preset file as read for the detail panel (and to open it). */
export type FileState =
  | { state: "loading" }
  | { state: "ready"; preset: Preset }
  | { state: "failed"; error: string };

/** The review of an edit before it's saved, and its results once it is. */
export interface ReviewModel {
  /** The preset the edit was made on. */
  preset: UserPreset;
  edits: Edits;
  changes: EditChange[];
  /** The preset, then the others with its filament ID. */
  targets: UserPreset[];
  ticked: ReadonlySet<string>;
  cursor: number;
  range: RangeState;
  phase: "review" | "saving" | "done";
  /** One per ticked target, in targets order, once saved. */
  results: EditResult[] | null;
  spoolease: SpoolEaseOutcome | null;
  error: string;
}

export interface PresetsModel {
  view: "list" | "editor" | "review";
  /** The highlighted preset's file. */
  path: string | undefined;
  filter: { text: TextState; focused: boolean };
  /** Preset files read so far, by path; cleared when the presets reload. */
  files: ReadonlyMap<string, FileState>;
  /** The preset being read to open in the editor. */
  opening: UserPreset | undefined;
  /** Unsaved edits by preset path, kept for the session. */
  drafts: ReadonlyMap<string, Edits>;
  editor: { preset: UserPreset; model: EditorModel } | null;
  review: ReviewModel | null;
}

type OwnMsg =
  | PresetFileMsg
  | RangeMsg
  | SavedMsg
  | { type: "presets/open"; path: string }
  | { type: "presets/filter" };

const EMPTY_TEXT: TextState = { value: "", cursor: 0 };

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function presetsIn(resource: Resource<PresetsData>): UserPreset[] {
  if (resource.state === "ready") return resource.value.presets;
  if (resource.state === "loading" || resource.state === "failed")
    return resource.previous?.presets ?? [];
  return [];
}

/** The presets the list shows now, in order, filtered. */
export function visiblePresets(model: PresetsModel, ctx: Ctx): UserPreset[] {
  return presetRows(presetsIn(ctx.resources.presets), model.filter.text.value);
}

/** Rows a page key moves by: the body less the panel's border, summary and margins. */
function pageRows(ctx: Ctx): number {
  return Math.max(1, ctx.bodyRows - 6);
}

/** Highlights a listed preset (the same one when it still is) and reads it when it hasn't been. */
function normalize(model: PresetsModel, presets: UserPreset[]): Step<PresetsModel> {
  const rows = presetRows(presets, model.filter.text.value);
  const path = rows.some((p) => p.path === model.path) ? model.path : rows[0]?.path;
  const next = { ...model, path };
  if (!path || next.files.has(path)) return [next, []];
  return [
    { ...next, files: new Map(next.files).set(path, { state: "loading" }) },
    [readPresetCmd(path)],
  ];
}

export function init(ctx: Ctx, _start: StartOptions): Step<PresetsModel> {
  const model: PresetsModel = {
    view: "list",
    path: undefined,
    filter: { text: EMPTY_TEXT, focused: false },
    files: new Map(),
    opening: undefined,
    drafts: new Map(),
    editor: null,
    review: null,
  };
  const [next, cmds] = normalize(model, presetsIn(ctx.resources.presets));
  return [next, [send<AppMsg>({ type: "app/load", resource: "presets" }), ...cmds]];
}

/** Reads the preset fresh and opens it in the editor once it's read. */
function open(model: PresetsModel, preset: UserPreset): Step<PresetsModel> {
  const files = model.files.has(preset.path)
    ? model.files
    : new Map(model.files).set(preset.path, { state: "loading" } as FileState);
  return [{ ...model, path: preset.path, opening: preset, files }, [readPresetCmd(preset.path)]];
}

function listKey(model: PresetsModel, key: KeyPress, ctx: Ctx): Step<PresetsModel> {
  const presets = presetsIn(ctx.resources.presets);
  const rows = presetRows(presets, model.filter.text.value);
  const cursor = Math.max(
    0,
    rows.findIndex((p) => p.path === model.path),
  );
  const highlighted = rows[cursor];
  // Moving on cancels a preset still being read to open.
  const moveTo = (index: number) =>
    normalize({ ...model, path: rows[index]?.path, opening: undefined }, presets);
  const moved = (keys: KeyPress) => moveCursor(cursor, keys, rows.length, pageRows(ctx));
  const clearFilter = () =>
    normalize({ ...model, filter: { text: EMPTY_TEXT, focused: false } }, presets);

  if (model.filter.focused) {
    if (key.name === "esc") return clearFilter();
    if (key.name === "enter") {
      const unfocused = { ...model, filter: { ...model.filter, focused: false } };
      return highlighted ? open(unfocused, highlighted) : [unfocused, []];
    }
    if (
      key.name === "up" ||
      key.name === "down" ||
      key.name === "pageUp" ||
      key.name === "pageDown"
    )
      return moveTo(moved(key) ?? cursor);
    const edited = editText(model.filter.text, key);
    if (!edited) return [model, []];
    const text = { value: edited.value, cursor: edited.cursor };
    return normalize({ ...model, filter: { text, focused: true } }, presets);
  }

  if (key.name === "esc") return model.filter.text.value ? clearFilter() : [model, []];
  if (key.name === "enter") return highlighted ? open(model, highlighted) : [model, []];
  const to = moved(key);
  if (to !== null) return moveTo(to);
  if (typed(key) === "/") return [{ ...model, filter: { ...model.filter, focused: true } }, []];
  const jump = letter(key);
  if (jump)
    return moveTo(
      typeAhead(
        rows.map((p) => p.name),
        cursor,
        jump,
      ),
    );
  return [model, []];
}

/** The review of the editor's edits: the targets, and SpoolEase's range when the edit changes it. */
function startReview(
  model: PresetsModel,
  preset: UserPreset,
  editor: EditorModel,
  ctx: Ctx,
): Step<PresetsModel> {
  const edits = editor.edits;
  const changes = editChanges(editor.original, edits);
  const targets = presetFamily(presetsIn(ctx.resources.presets), preset);
  const range = nozzleRange(applyEdits(editor.original, edits).preset);
  const connection = spooleaseConnection(ctx.values);
  const checks =
    changes.some((c) => c.key.startsWith("nozzle_temperature_range_")) &&
    range !== null &&
    preset.filamentId !== "" &&
    connection !== null;
  const review: ReviewModel = {
    preset,
    edits,
    changes,
    targets,
    ticked: new Set(targets.map((t) => t.path)),
    cursor: 0,
    range: checks ? { state: "checking" } : { state: "none" },
    phase: "review",
    results: null,
    spoolease: null,
    error: "",
  };
  return [
    { ...model, view: "review", review, editor: { preset, model: editor } },
    checks && range && connection
      ? [rangeCmd(preset.path, preset.filamentId, range, connection)]
      : [],
  ];
}

function withDraft(drafts: ReadonlyMap<string, Edits>, path: string, edits: Edits) {
  const next = new Map(drafts);
  if (edits.size > 0) next.set(path, edits);
  else next.delete(path);
  return next;
}

function editorKey(model: PresetsModel, key: KeyPress, ctx: Ctx): Step<PresetsModel> {
  const editor = model.editor;
  if (!editor) return [{ ...model, view: "list" }, []];
  const step = updateEditor(editor.model, key, pageRows(ctx));
  const outcome = step.outcome;
  if (outcome?.type === "leave")
    return [
      {
        ...model,
        view: "list",
        editor: null,
        drafts: withDraft(model.drafts, editor.preset.path, outcome.edits),
      },
      [],
    ];
  if (outcome?.type === "review") return startReview(model, editor.preset, step.model, ctx);
  return [{ ...model, editor: { ...editor, model: step.model } }, []];
}

function reviewKey(model: PresetsModel, key: KeyPress, ctx: Ctx): Step<PresetsModel> {
  const review = model.review;
  if (!review) return [{ ...model, view: "list" }, []];
  if (review.phase === "saving") return [model, []];
  if (review.phase === "done") {
    if (key.name === "esc" || key.name === "enter")
      return [{ ...model, view: "list", review: null, editor: null }, []];
    return [model, []];
  }
  const set = (changes: Partial<ReviewModel>): Step<PresetsModel> => [
    { ...model, review: { ...review, error: "", ...changes } },
    [],
  ];
  if (key.name === "esc") return [{ ...model, view: "editor", review: null }, []];
  const moved = moveCursor(review.cursor, key, review.targets.length, pageRows(ctx));
  if (moved !== null) return set({ cursor: moved });
  if (key.name === "space") {
    const target = review.targets[review.cursor];
    if (!target) return [model, []];
    const ticked = new Set(review.ticked);
    if (ticked.has(target.path)) ticked.delete(target.path);
    else ticked.add(target.path);
    return set({ ticked });
  }
  if (typed(key) === "a") {
    const paths = review.targets.map((t) => t.path).filter((p) => review.ticked.has(p));
    if (paths.length === 0) return set({ error: "Tick at least one preset to save to" });
    if (review.range.state === "checking")
      return set({ error: "Still reading SpoolEase's nozzle range" });
    const change = review.range.state === "change" ? review.range.change : null;
    return [
      { ...model, review: { ...review, phase: "saving", error: "" } },
      [saveCmd(review.preset.path, paths, review.edits, change, spooleaseConnection(ctx.values))],
    ];
  }
  return [model, []];
}

function onKey(model: PresetsModel, key: KeyPress, ctx: Ctx): Step<PresetsModel> {
  if (model.view === "editor") return editorKey(model, key, ctx);
  if (model.view === "review") return reviewKey(model, key, ctx);
  return listKey(model, key, ctx);
}

function onRead(model: PresetsModel, msg: PresetFileMsg): Step<PresetsModel> {
  const file: FileState =
    "preset" in msg
      ? { state: "ready", preset: msg.preset }
      : { state: "failed", error: msg.error };
  const files = new Map(model.files).set(msg.path, file);
  const opening = model.opening;
  if (opening?.path !== msg.path) return [{ ...model, files }, []];
  if (!("preset" in msg)) return [{ ...model, files, opening: undefined }, []];
  const draft = model.drafts.get(opening.path);
  const editor = initEditor({
    name: opening.name,
    printer: opening.printer,
    path: opening.path,
    original: msg.preset,
    ...(draft ? { edits: draft } : {}),
    mode: "preset",
  });
  return [
    {
      ...model,
      files,
      opening: undefined,
      view: "editor",
      editor: { preset: opening, model: editor },
      review: null,
    },
    [],
  ];
}

function onSaved(model: PresetsModel, msg: SavedMsg): Step<PresetsModel> {
  const review = model.review;
  if (!review || review.preset.path !== msg.path) return [model, []];
  const saved = msg.results.filter((r) => r.ok).length;
  const failed = msg.results.length - saved;
  const name = review.preset.name;
  const lines = [
    `${plural(saved, "BambuStudio preset")} of ${name} saved${failed ? `, ${failed} failed` : ""}: restart BambuStudio to load`,
    ...msg.results
      .filter((r) => !r.ok)
      .map((r) => {
        const target = review.targets.find((t) => t.path === r.path);
        return `${target ? presetTitle(target) : r.path}: ${r.detail}`;
      }),
    ...(msg.spoolease ? [msg.spoolease.line] : []),
  ];
  const ok = failed === 0 && msg.spoolease?.ok !== false;
  const exitCode: 1 | 2 | undefined = ok ? undefined : msg.setupError ? 2 : 1;
  const toast = [
    `${ok ? "✓" : "✗"} Saved ${plural(saved, "preset")} of ${name}`,
    failed ? `, ${failed} failed` : "",
    msg.spoolease?.ok === false ? "; SpoolEase's range unchanged" : "",
  ].join("");
  const files = new Map(model.files);
  for (const result of msg.results) files.delete(result.path);
  const drafts = new Map(model.drafts);
  drafts.delete(msg.path);
  const appMsgs: AppMsg[] = [
    { type: "app/runFinished", summary: { ok, lines, ...(exitCode ? { exitCode } : {}) } },
    { type: "app/load", resource: "presets", force: true },
    ...(msg.spoolease?.ok
      ? ([
          { type: "app/load", resource: "console", force: true },
          { type: "app/load", resource: "check", force: true },
        ] as AppMsg[])
      : []),
    { type: "app/toast", text: toast, tone: ok ? "ok" : "failed" },
  ];
  return [
    {
      ...model,
      files,
      drafts,
      review: { ...review, phase: "done", results: msg.results, spoolease: msg.spoolease },
    },
    [send(...appMsgs)],
  ];
}

/** Opens a preset by path from anywhere (the command palette): leaves the editor, keeping its draft. */
function onOpen(model: PresetsModel, path: string, ctx: Ctx): Step<PresetsModel> {
  const switchTab: Cmd<AppMsg> = send({ type: "app/switchTab", tab: "presets" });
  if (model.review?.phase === "saving") return [model, [switchTab]];
  const presets = presetsIn(ctx.resources.presets);
  const preset = presets.find((p) => p.path === path);
  if (!preset) return [model, [switchTab]];
  const editor = model.editor;
  const left: PresetsModel = {
    ...model,
    view: "list",
    editor: null,
    review: null,
    drafts: editor ? withDraft(model.drafts, editor.preset.path, editor.model.edits) : model.drafts,
    filter: presetRows(presets, model.filter.text.value).some((p) => p.path === path)
      ? model.filter
      : { text: EMPTY_TEXT, focused: false },
  };
  const [opened, cmds] = open(left, preset);
  return [opened, [switchTab, ...cmds]];
}

export function update(model: PresetsModel, msg: AppMsg | TabMsg, ctx: Ctx): Step<PresetsModel> {
  const own = msg as OwnMsg;
  switch (msg.type) {
    case "key":
      return onKey(model, (msg as { key: KeyPress }).key, ctx);
    case "paste":
      return onKey(
        model,
        { input: (msg as { text: string }).text, ctrl: false, shift: false, meta: false },
        ctx,
      );
    case "app/loaded": {
      const loaded = msg as Extract<AppMsg, { type: "app/loaded" }>;
      if (loaded.resource !== "presets") return [model, []];
      return normalize(
        { ...model, files: new Map() },
        presetsIn(loaded.result as Resource<PresetsData>),
      );
    }
    case "presets/read":
      return onRead(model, own as PresetFileMsg);
    case "presets/range": {
      const range = own as RangeMsg;
      const review = model.review;
      if (!review || review.preset.path !== range.path || review.range.state !== "checking")
        return [model, []];
      return [{ ...model, review: { ...review, range: range.range } }, []];
    }
    case "presets/saved":
      return onSaved(model, own as SavedMsg);
    case "presets/open":
      return onOpen(model, (own as { path: string }).path, ctx);
    case "presets/filter": {
      const switchTab = send<AppMsg>({ type: "app/switchTab", tab: "presets" });
      if (model.view !== "list") return [model, [switchTab]];
      return [{ ...model, filter: { ...model.filter, focused: true } }, [switchTab]];
    }
    default:
      return [model, []];
  }
}

export function capturesText(model: PresetsModel): boolean {
  if (model.view === "editor") return model.editor ? editorCapturesText(model.editor.model) : false;
  if (model.view === "review") return false;
  return model.filter.focused;
}

export function hints(model: PresetsModel, _ctx: Ctx): Hint[] {
  if (model.view === "editor" && model.editor) return editorHints(model.editor.model);
  if (model.view === "review" && model.review) {
    if (model.review.phase === "saving") return [];
    if (model.review.phase === "done")
      return [{ keys: "esc", label: "back to presets", primary: true }];
    return [
      { keys: "a", label: "save", primary: true },
      { keys: "space", label: "tick", primary: true },
      { keys: "esc", label: "back", primary: true },
      { keys: "↑↓", label: "move" },
    ];
  }
  if (model.filter.focused)
    return [
      { keys: "enter", label: "edit", primary: true },
      { keys: "esc", label: "clear", primary: true },
      { keys: "↑↓", label: "move" },
    ];
  return [
    { keys: "enter", label: "edit", primary: true },
    { keys: "/", label: "filter", primary: true },
    ...(model.filter.text.value ? [{ keys: "esc", label: "clear filter", primary: true }] : []),
    { keys: "↑↓", label: "move" },
    { keys: "a–z", label: "jump" },
  ];
}

export function commands(_model: PresetsModel, ctx: Ctx): PaletteCommand[] {
  const detail = "Presets";
  return [
    {
      title: "Reload presets",
      detail,
      msg: { type: "app/load", resource: "presets", force: true },
    },
    { title: "Filter presets", detail, msg: toTab("presets", { type: "presets/filter" }) },
    ...presetRows(presetsIn(ctx.resources.presets), "").map((preset) => ({
      title: `Edit ${presetTitle(preset)}`,
      detail,
      msg: toTab("presets", { type: "presets/open", path: preset.path }),
    })),
  ];
}
