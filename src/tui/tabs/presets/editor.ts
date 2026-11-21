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
 * Keys: ←/→ page, 1-7 jump to a page · ↑↓ pgup pgdn home end move · enter edit (switches toggle; space
 * too) · u / ctrl+u undo the field · / filter (All settings; enter keeps it, esc clears) · a review
 * (preset) or done (planned) · esc back. While typing: the value opens selected (model.selected), so
 * typing replaces it and backspace clears it, while home/end/← → (in text) start editing it; a number
 * steps with ←→ or ↑↓ (shift: ×5, within its bounds); enter sets (checked by parseField/parseRaw, an
 * error keeps typing), esc cancels, a pasted burst ending in a newline sets it; every printable key types.
 */

import {
  applyEdits,
  EDIT_FIELDS,
  type EditChange,
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
import { editText, filterRows, moveCursor, type TextState } from "../../ui/index.js";

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
  /** The whole value being typed is selected (as it opens, and after a step): typing replaces it. */
  readonly selected: boolean;
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

/** Page titles that say more than their group: Temperature holds only the nozzle's (Bed has the plates'). */
const PAGE_TITLES: Record<string, string> = { Temperature: "Nozzle" };

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
    selected: false,
    filter: { text: EMPTY_TEXT, focused: false },
    error: "",
  };
}

/** Values for people: "220°C" (no space before the degree sign), as everywhere in the TUI. */
export function tidyUnits(text: string): string {
  return text.replace(/ °C/g, "°C");
}

/** The changes so far, for the side panel and the review. */
export function editorChanges(model: EditorModel): EditChange[] {
  return editChanges(model.original, model.edits).map((change) => ({
    ...change,
    from: tidyUnits(change.from),
    to: tidyUnits(change.to),
  }));
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
  const keys = Object.keys(editedPreset(model));
  // Words split on underscores too, so "range low" finds nozzle_temperature_range_low.
  const words = model.filter.text.value.replace(/_/g, " ");
  return filterRows(keys, words).map((match) => keys[match.index] ?? "");
}

function rawShown(value: unknown): string {
  const text = rawText(value) ?? JSON.stringify(value);
  return text === "" ? '""' : text;
}

/** "Direct Drive High Flow" → "high flow": the nozzle type a variant is for, as BambuStudio names it. */
function variantName(name: string): string {
  return name.replace(/^Direct Drive /, "").toLowerCase();
}

/**
 * A field's value for people: "220°C"; variants that differ each tagged with their nozzle type when
 * the preset names them ("standard 22 · high flow 29 mm³/s").
 */
function fieldShown(field: EditField, preset: Preset, value: unknown): string {
  const names = preset.filament_extruder_variant;
  if (
    differingVariants(value) &&
    Array.isArray(value) &&
    Array.isArray(names) &&
    names.length === value.length &&
    names.every((n) => typeof n === "string" && n)
  ) {
    // The unit once, at the end: "standard 22 · high flow 29 mm³/s".
    const bare: EditField = { ...field, unit: "" };
    const each = value.map(
      (entry, index) => `${variantName(names[index] as string)} ${shownValue(bare, [entry])}`,
    );
    return tidyUnits(`${each.join(" · ")}${field.unit ? ` ${field.unit}` : ""}`);
  }
  return tidyUnits(shownValue(field, value));
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
      value: fieldShown(field, edited, edited[field.key]),
      ...(changed ? { was: fieldShown(field, model.original, model.original[field.key]) } : {}),
      changed,
      field,
    };
  });
}

export function editorPages(model: EditorModel): EditorPage[] {
  const count = (keys: string[]) => keys.filter((key) => model.edits.has(key)).length;
  const badge = (n: number) => (n > 0 ? { badge: String(n) } : {});
  const groups = EDITOR_GROUPS.map((group, page) => ({
    id: group.toLowerCase(),
    title: PAGE_TITLES[group] ?? group,
    ...badge(count(groupFields(page).map((f) => f.key))),
  }));
  const raw = [...model.edits.keys()].filter((key) => !editField(key)).length;
  // "All", short, so every page fits the bar of a 120-column editor.
  return [...groups, { id: "all", title: "All", ...badge(raw) }];
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

/** The row at the cursor, if the page has any. */
export function editorCurrentRow(model: EditorModel): EditorRow | undefined {
  return currentRow(model);
}

function differingVariants(value: unknown): number {
  return Array.isArray(value) && value.length > 1 && value.some((v) => v !== value[0])
    ? value.length
    : 0;
}

/** What the highlighted setting takes ("whole number, 0–500"); "" when it can't be changed here. */
export function editorTakes(model: EditorModel): string {
  const row = currentRow(model);
  if (!row) return "";
  const field = row.field;
  if (!field) {
    const value = editedPreset(model)[row.key];
    if (row.locked || rawText(value) === null) return "";
    const variants = differingVariants(value);
    if (variants) return `a JSON list of ${variants} values`;
    const text = rawText(value) ?? "";
    if (/gcode|notes/.test(row.key) || text.includes("\\n")) return "text; \\n starts a new line";
    return text !== "" && Number.isFinite(Number(text)) ? "a number" : "text";
  }
  const nil = field.nilable ? ", or nothing for the printer's" : "";
  // An edit writes one value for every variant (editField's { every }).
  const one = differingVariants(editedPreset(model)[field.key])
    ? "; one value for every nozzle type"
    : "";
  switch (field.kind) {
    case "int":
      return `whole number, ${field.min}–${field.max}${nil}${one}`;
    case "decimal":
      return `number, ${field.min}–${field.max}${nil}${one}`;
    case "color":
      return "6 hex digits, or nothing for none";
    case "text":
      return "text; \\n starts a new line";
    case "switch":
      return "on or off";
  }
}

/** Temperatures most filaments print within; outside them the editor warns but still takes the value. */
const NOZZLE_USUAL = { low: 150, high: 350 };
const BED_USUAL_HIGH = 120;

/** Why a value typed for key looks wrong ("5°C is low for a nozzle…"); "" when it looks fine. */
export function editWarning(key: string, value: string): string {
  const text = value.trim();
  const n = Number(text);
  if (text === "" || !Number.isFinite(n)) return "";
  if (key.startsWith("nozzle_temperature")) {
    const usual = `(most take ${NOZZLE_USUAL.low}–${NOZZLE_USUAL.high}°C)`;
    if (n < NOZZLE_USUAL.low) return `${n}°C is low for a nozzle ${usual}`;
    if (n > NOZZLE_USUAL.high) return `${n}°C is high for a nozzle ${usual}`;
  }
  if (/_plate_temp(_initial_layer)?$/.test(key) && n > BED_USUAL_HIGH)
    return `${n}°C is high for a bed (most go up to ${BED_USUAL_HIGH}°C)`;
  return "";
}

/** The highlighted field's warning: for the value being typed, else for its edit; "" when it has none. */
export function editorWarning(model: EditorModel): string {
  const row = currentRow(model);
  if (!row?.field) return "";
  if (model.text !== null) return editWarning(row.key, model.text.value);
  const edit = model.edits.get(row.key);
  if (!edit) return "";
  return editWarning(row.key, "every" in edit ? edit.every : (edit.each[0] ?? ""));
}

/** What the field being typed takes; "" when not typing. */
export function editorTypingHint(model: EditorModel): string {
  return model.text === null ? "" : editorTakes(model);
}

export function editorHints(model: EditorModel): Hint[] {
  if (model.text !== null)
    return [
      ...(stepOf(currentRow(model)?.field) !== null
        ? [
            { keys: "←→", label: "step", primary: true },
            { keys: "shift+←→", label: "step ×5" },
          ]
        : []),
      { keys: "enter", label: "set", primary: true },
      { keys: "esc", label: "cancel", primary: true },
    ];
  if (model.filter.focused)
    return [
      { keys: "↑↓", label: "move" },
      { keys: "enter", label: "done", primary: true },
      { keys: "esc", label: "clear", primary: true },
    ];
  const row = currentRow(model);
  const hints: Hint[] = [
    { keys: "↑↓", label: "move" },
    row?.field?.kind === "switch"
      ? { keys: "space", label: "toggle", primary: true }
      : { keys: "enter", label: "edit", primary: true },
  ];
  if (row?.changed) hints.push({ keys: "u", label: "undo", primary: true });
  if (model.page === ALL_SETTINGS) hints.push({ keys: "/", label: "filter", primary: true });
  hints.push(
    model.mode === "preset"
      ? { keys: "a", label: "review", primary: true }
      : { keys: "a", label: "done", primary: true },
    { keys: "←→", label: "page", primary: true },
    { keys: `1-${ALL_SETTINGS + 1}`, label: "jump to a page" },
    { keys: "esc", label: "back", primary: true },
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
      selected: false,
      error: "",
      edits: withEdit(model.original, model.edits, row.key, parsed.edit),
    },
  };
}

/** How far ←→ step a curated number field; null for fields that aren't numbers. */
const STEPS: Record<string, number> = {
  filament_flow_ratio: 0.01,
  filament_max_volumetric_speed: 0.5,
  pressure_advance: 0.001,
  filament_retraction_length: 0.1,
  filament_density: 0.01,
};

function stepOf(field: EditField | undefined): number | null {
  if (field?.kind === "int") return 1;
  if (field?.kind === "decimal") return STEPS[field.key] ?? 1;
  return null;
}

/** The typed number moved by delta steps, kept within the field's bounds, as text. */
function stepped(model: EditorModel, field: EditField, text: string, delta: number): string {
  const step = stepOf(field) ?? 1;
  const from = (value: string) => (value.trim() === "" ? Number.NaN : Number(value));
  let current = from(text);
  if (!Number.isFinite(current)) current = from(fieldText(field, editedPreset(model)[field.key]));
  const low = field.min ?? -Infinity;
  const high = field.max ?? Infinity;
  const next = Number.isFinite(current)
    ? current + delta * step
    : Number.isFinite(low)
      ? low + Math.max(0, delta) * step
      : 0;
  const places = (String(step).split(".")[1] ?? "").length;
  return String(Number(Math.min(high, Math.max(low, next)).toFixed(places)));
}

function typing(model: EditorModel, text: TextState, key: KeyPress): EditorStep {
  if (key.name === "esc") return { model: { ...model, text: null, selected: false, error: "" } };
  if (key.name === "enter") return commit(model, text);
  const field = currentRow(model)?.field;
  const arrows: Record<string, number> = { right: 1, up: 1, left: -1, down: -1 };
  const arrow = key.name ? arrows[key.name] : undefined;
  if (arrow !== undefined && field && stepOf(field) !== null) {
    const value = stepped(model, field, text.value, arrow * (key.shift ? 5 : 1));
    return {
      model: { ...model, text: { value, cursor: value.length }, selected: true, error: "" },
    };
  }
  let from = text;
  if (model.selected) {
    // Typing (or a paste) replaces the selected value and backspace clears it; moving starts editing it.
    if (key.name === "backspace" || key.name === "delete")
      return { model: { ...model, text: EMPTY_TEXT, selected: false, error: "" } };
    if ((!key.name && !key.ctrl && !key.meta) || key.name === "space") from = EMPTY_TEXT;
  }
  const edited = editText(from, key);
  if (!edited) return { model };
  const next = { value: edited.value, cursor: edited.cursor };
  if (edited.submit) return commit({ ...model, selected: false }, next);
  return { model: { ...model, text: next, selected: false, error: "" } };
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
  return { model: { ...model, text: { value, cursor: value.length }, selected: true, error: "" } };
}

function filtering(model: EditorModel, key: KeyPress, pageRows: number): EditorStep {
  if (key.name === "esc")
    return { model: withCursor({ ...model, filter: { text: EMPTY_TEXT, focused: false } }, 0) };
  // enter keeps the filter and leaves the field; enter again edits the highlighted key.
  if (key.name === "enter")
    return { model: { ...model, filter: { ...model.filter, focused: false } } };
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
    model: withCursor(
      {
        ...model,
        error: "",
        filter: { text: { value: edited.value, cursor: edited.cursor }, focused: !edited.submit },
      },
      0,
    ),
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
  const page = /^[1-9]$/.test(text) ? Number(text) - 1 : -1;
  if (page >= 0 && page <= ALL_SETTINGS) return { model: { ...clear, page } };
  return { model };
}

function undo(model: EditorModel): EditorStep {
  const row = currentRow(model);
  if (!row) return { model };
  return { model: { ...model, edits: withEdit(model.original, model.edits, row.key, null) } };
}
