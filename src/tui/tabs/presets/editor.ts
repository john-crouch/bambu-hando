// ABOUTME: The preset editor as a pure model, embeddable anywhere: pages per setting group, All settings as raw text.
// ABOUTME: Hosts (the Presets tab, the Add tab's review) feed it keys and act on the outcomes it returns.

/*
 * Editor API (pure; no I/O, no Ink):
 *
 *   initEditor({ name, printer, path?, original, edits?, mode }) → EditorModel
 *     original: the preset as on disk (mode "preset") or as a run would write it (mode "planned").
 *     edits: a draft to continue from (keys → EditValue); only real changes are ever kept.
 *
 *   updateEditor(model, key, pageRows?) → { model, outcome? }
 *     outcome, when the host has something to do:
 *       { type: "leave", edits }   esc: done editing; keep edits as a draft (preset) or for the run (planned).
 *       { type: "review", edits }  a, mode "preset": show the review (something changed, range runs low → high).
 *       { type: "error", message } a or esc refused; the message is also in model.error, shown by the view.
 *     In mode "planned" a also leaves, since the host's own review is where it goes back to; leaving a
 *     planned preset needs a valid nozzle range, as the run writes it as it is.
 *
 *   editorHints(model) → Hint[]        the keys that work now, in footer order.
 *   editorCapturesText(model)          true while a value or the All settings filter is being typed.
 *   editorPages(model)                 page titles and change counts, for the page bar.
 *   editorRows(model)                  the current page's rows (label, shown value, was, changed, locked).
 *   editorTypingHint(model)            what the field being typed takes ("whole number, 0–500").
 *   editedPreset(model)                original with the edits applied.
 *   withEdit(original, edits, key, v)  edits with v for key (null removes it); drops edits that change nothing.
 *
 * Keys: ←/→ page · ↑↓ pgup pgdn home end move · enter edit (switches toggle; space too) · u / ctrl+u undo
 * the field · / filter (All settings) · a review (preset) or done (planned) · esc back. While typing:
 * enter sets (checked by parseField/parseRaw, an error keeps typing), esc cancels, a pasted burst ending
 * in a newline sets it; every printable key types.
 */

import {
  applyEdits,
  EDIT_FIELDS,
  type EditField,
  type Edits,
  type EditValue,
  editChanges,
  editField,
  fieldText,
  lockedReason,
  type Preset,
  parseField,
  parseRaw,
  rangeError,
  rawText,
  shownValue,
} from "../../../presetEdit.js";
import { type KeyPress, typed } from "../../core/keys.js";
import type { Hint } from "../../core/types.js";
import { editText, matchesWords, moveCursor, type TextState } from "./helpers.js";

export type EditorMode = "preset" | "planned";

/** The setting groups, one page each, in EDIT_FIELDS order; All settings comes after them. */
export const EDITOR_GROUPS: readonly string[] = [...new Set(EDIT_FIELDS.map((f) => f.group))];

/** The page index of All settings. */
export const ALL_SETTINGS = EDITOR_GROUPS.length;

const DEFAULT_PAGE_ROWS = 10;

export interface EditorInit {
  name: string;
  printer: string;
  path?: string;
  original: Preset;
  edits?: Edits;
  mode: EditorMode;
}

export interface EditorModel {
  readonly name: string;
  readonly printer: string;
  readonly path: string | undefined;
  readonly mode: EditorMode;
  readonly original: Preset;
  readonly edits: Edits;
  /** 0..EDITOR_GROUPS.length - 1 for a group, ALL_SETTINGS for every key. */
  readonly page: number;
  /** One cursor per page, kept while on other pages. */
  readonly cursors: readonly number[];
  /** The value being typed for the row at the cursor; null when not typing. */
  readonly text: TextState | null;
  /** All settings' filter; focused while typing into it. */
  readonly filter: { text: TextState; focused: boolean };
  readonly error: string;
}

export type EditorOutcome =
  | { type: "leave"; edits: Edits }
  | { type: "review"; edits: Edits }
  | { type: "error"; message: string };

export interface EditorStep {
  model: EditorModel;
  outcome?: EditorOutcome;
}

export interface EditorRow {
  key: string;
  /** The field's label, or the key on All settings. */
  label: string;
  /** The value as shown, with the edits. */
  value: string;
  /** The value on disk, when changed. */
  was?: string;
  changed: boolean;
  /** Why the key can't be changed here (All settings only). */
  locked?: string;
  /** The curated field, on group pages. */
  field?: EditField;
}

export interface EditorPage {
  id: string;
  title: string;
  /** How many of the page's settings are changed, when any. */
  badge?: string;
}

const EMPTY_TEXT: TextState = { value: "", cursor: 0 };

export function initEditor(init: EditorInit): EditorModel {
  return {
    name: init.name,
    printer: init.printer,
    path: init.path,
    mode: init.mode,
    original: init.original,
    edits: init.edits ?? new Map(),
    page: 0,
    cursors: Array.from({ length: ALL_SETTINGS + 1 }, () => 0),
    text: null,
    filter: { text: EMPTY_TEXT, focused: false },
    error: "",
  };
}

/** `edits` with `value` for `key`, or without it when value is null or leaves the setting as it is in `original`. */
export function withEdit(
  original: Preset,
  edits: Edits,
  key: string,
  value: EditValue | null,
): Edits {
  const next = new Map(edits);
  next.delete(key);
  if (value && editChanges(original, new Map([[key, value]])).length > 0) next.set(key, value);
  return next;
}

export function editedPreset(model: EditorModel): Preset {
  return applyEdits(model.original, model.edits).preset;
}

function groupFields(page: number): EditField[] {
  const group = EDITOR_GROUPS[page];
  return EDIT_FIELDS.filter((f) => f.group === group);
}

function rawKeys(model: EditorModel): string[] {
  return Object.keys(editedPreset(model)).filter((key) =>
    matchesWords(key, model.filter.text.value, /[\s_]+/),
  );
}

function rawShown(value: unknown): string {
  const text = rawText(value) ?? JSON.stringify(value);
  return text === "" ? '""' : text;
}

/** The current page's rows. */
export function editorRows(model: EditorModel): EditorRow[] {
  const edited = editedPreset(model);
  if (model.page === ALL_SETTINGS) {
    return rawKeys(model).map((key) => {
      const changed = model.edits.has(key);
      const locked = lockedReason(key);
      return {
        key,
        label: key,
        value: rawShown(edited[key]),
        ...(changed ? { was: rawShown(model.original[key]) } : {}),
        changed,
        ...(locked ? { locked } : {}),
      };
    });
  }
  return groupFields(model.page).map((field) => {
    const changed = model.edits.has(field.key);
    return {
      key: field.key,
      label: field.label,
      value: shownValue(field, edited[field.key]),
      ...(changed ? { was: shownValue(field, model.original[field.key]) } : {}),
      changed,
      field,
    };
  });
}

export function editorPages(model: EditorModel): EditorPage[] {
  const count = (keys: string[]) => keys.filter((key) => model.edits.has(key)).length;
  const badge = (n: number) => (n > 0 ? { badge: String(n) } : {});
  const groups = EDITOR_GROUPS.map((title, page) => ({
    id: title.toLowerCase(),
    title,
    ...badge(count(groupFields(page).map((f) => f.key))),
  }));
  const raw = [...model.edits.keys()].filter((key) => !editField(key)).length;
  return [...groups, { id: "all", title: "All settings", ...badge(raw) }];
}

export function editorCapturesText(model: EditorModel): boolean {
  return model.text !== null || model.filter.focused;
}

function cursorOf(model: EditorModel): number {
  return model.cursors[model.page] ?? 0;
}

function currentRow(model: EditorModel): EditorRow | undefined {
  const rows = editorRows(model);
  return rows[Math.min(cursorOf(model), rows.length - 1)];
}

/** What the field being typed takes; "" when not typing one. */
export function editorTypingHint(model: EditorModel): string {
  if (model.text === null) return "";
  const field = currentRow(model)?.field;
  if (!field) return "\\n starts a new line";
  const nil = field.nilable ? "; nothing: printer's" : "";
  switch (field.kind) {
    case "int":
      return `whole number, ${field.min}–${field.max}${nil}`;
    case "decimal":
      return `number, ${field.min}–${field.max}${nil}`;
    case "color":
      return "6 hex digits; nothing: none";
    case "text":
      return "\\n starts a new line";
    case "switch":
      return "";
  }
}

export function editorHints(model: EditorModel): Hint[] {
  if (model.text !== null)
    return [
      { keys: "enter", label: "set", primary: true },
      { keys: "esc", label: "cancel", primary: true },
    ];
  if (model.filter.focused)
    return [
      { keys: "enter", label: "edit", primary: true },
      { keys: "esc", label: "clear", primary: true },
      { keys: "↑↓", label: "move" },
    ];
  const row = currentRow(model);
  const hints: Hint[] = [
    row?.field?.kind === "switch"
      ? { keys: "space", label: "toggle", primary: true }
      : { keys: "enter", label: "edit", primary: true },
  ];
  if (row?.changed) hints.push({ keys: "u", label: "undo", primary: true });
  if (model.page === ALL_SETTINGS) hints.push({ keys: "/", label: "filter", primary: true });
  hints.push(
    { keys: "←→", label: "page", primary: true },
    model.mode === "preset"
      ? { keys: "a", label: "review", primary: true }
      : { keys: "a", label: "done", primary: true },
    { keys: "esc", label: "back", primary: true },
    { keys: "↑↓", label: "move" },
  );
  return hints;
}

function withCursor(model: EditorModel, cursor: number): EditorModel {
  const cursors = [...model.cursors];
  cursors[model.page] = cursor;
  return { ...model, cursors };
}

function refuse(model: EditorModel, message: string): EditorStep {
  return { model: { ...model, error: message }, outcome: { type: "error", message } };
}

/** The value typed into the row at the cursor, set, or kept typing with the reason it doesn't fit. */
function commit(model: EditorModel, text: TextState): EditorStep {
  const row = currentRow(model);
  if (!row) return { model: { ...model, text: null } };
  const parsed = row.field
    ? (() => {
        const result = parseField(row.field, text.value);
        return "error" in result ? result : { edit: { every: result.value } };
      })()
    : parseRaw(editedPreset(model)[row.key], text.value);
  if ("error" in parsed) return { model: { ...model, text, error: parsed.error } };
  return {
    model: {
      ...model,
      text: null,
      error: "",
      edits: withEdit(model.original, model.edits, row.key, parsed.edit),
    },
  };
}

function typing(model: EditorModel, text: TextState, key: KeyPress): EditorStep {
  if (key.name === "esc") return { model: { ...model, text: null, error: "" } };
  if (key.name === "enter") return commit(model, text);
  const edited = editText(text, key);
  if (!edited) return { model };
  if (edited.enter) return commit(model, edited.state);
  return { model: { ...model, text: edited.state, error: "" } };
}

/** Starts typing the row at the cursor, toggles a switch, or says why the row can't be edited. */
function edit(model: EditorModel): EditorStep {
  const row = currentRow(model);
  if (!row) return { model };
  const edited = editedPreset(model);
  if (row.field?.kind === "switch") {
    const on = fieldText(row.field, edited[row.key]) === "1";
    return {
      model: {
        ...model,
        error: "",
        edits: withEdit(model.original, model.edits, row.key, { every: on ? "0" : "1" }),
      },
    };
  }
  let value: string;
  if (row.field) value = fieldText(row.field, edited[row.key]);
  else {
    if (row.locked)
      return { model: { ...model, error: `${row.key} can't be changed here: ${row.locked}` } };
    const raw = rawText(edited[row.key]);
    if (raw === null)
      return { model: { ...model, error: `${row.key} isn't text; change it in BambuStudio` } };
    value = raw;
  }
  return { model: { ...model, text: { value, cursor: value.length }, error: "" } };
}

function filtering(model: EditorModel, key: KeyPress, pageRows: number): EditorStep {
  if (key.name === "esc")
    return { model: withCursor({ ...model, filter: { text: EMPTY_TEXT, focused: false } }, 0) };
  if (key.name === "enter") return edit({ ...model, filter: { ...model.filter, focused: false } });
  if (
    key.name === "up" ||
    key.name === "down" ||
    key.name === "pageUp" ||
    key.name === "pageDown"
  ) {
    const moved = moveCursor(cursorOf(model), key, editorRows(model).length, pageRows);
    return { model: moved === null ? model : withCursor({ ...model, error: "" }, moved) };
  }
  const edited = editText(model.filter.text, key);
  if (!edited) return { model };
  return {
    model: withCursor({ ...model, error: "", filter: { text: edited.state, focused: true } }, 0),
  };
}

/** Leaving or reviewing: what the edits must satisfy first. */
function finish(model: EditorModel, type: "leave" | "review"): EditorStep {
  const range = rangeError(editedPreset(model));
  if (type === "review") {
    if (editChanges(model.original, model.edits).length === 0)
      return refuse(model, "Nothing changed yet");
    if (range) return refuse(model, range);
    return { model: { ...model, error: "" }, outcome: { type: "review", edits: model.edits } };
  }
  if (model.mode === "planned" && range) return refuse(model, range);
  return { model: { ...model, error: "" }, outcome: { type: "leave", edits: model.edits } };
}

export function updateEditor(
  model: EditorModel,
  key: KeyPress,
  pageRows: number = DEFAULT_PAGE_ROWS,
): EditorStep {
  if (model.text !== null) return typing(model, model.text, key);
  if (model.filter.focused) return filtering(model, key, pageRows);

  const clear = { ...model, error: "" };
  if (key.name === "esc") {
    if (model.page === ALL_SETTINGS && model.filter.text.value)
      return { model: withCursor({ ...clear, filter: { text: EMPTY_TEXT, focused: false } }, 0) };
    return finish(model, "leave");
  }
  if (key.name === "left" || key.name === "right") {
    const page = Math.min(ALL_SETTINGS, Math.max(0, model.page + (key.name === "left" ? -1 : 1)));
    return { model: { ...clear, page } };
  }
  const moved = moveCursor(cursorOf(model), key, editorRows(model).length, pageRows);
  if (moved !== null) return { model: withCursor(clear, moved) };
  if (key.name === "enter" || key.name === "space") {
    if (key.name === "space" && currentRow(model)?.field?.kind !== "switch") return { model };
    return edit(model);
  }
  const text = typed(key);
  if (key.ctrl && !key.meta && key.input.toLowerCase() === "u") return undo(clear);
  if (text === "u") return undo(clear);
  if (text === "a") return finish(model, model.mode === "preset" ? "review" : "leave");
  if (text === "/" && model.page === ALL_SETTINGS)
    return { model: { ...clear, filter: { ...model.filter, focused: true } } };
  return { model };
}

function undo(model: EditorModel): EditorStep {
  const row = currentRow(model);
  if (!row) return { model };
  return { model: { ...model, edits: withEdit(model.original, model.edits, row.key, null) } };
}
