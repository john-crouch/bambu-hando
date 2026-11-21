// ABOUTME: The labels overlay's model and pure update: which fields print, the label size, the printer and the PDF path.
// ABOUTME: Printer and PDF are chosen from lists; also the live preview of the first spool's label before making labels.

import { homedir } from "node:os";
import { join } from "node:path";

import type { LabelTarget } from "../../../labelJob.js";
import type { LabelSettings } from "../../../labelSettings.js";
import {
  LABEL_FIELDS,
  type LabelField,
  type LabelLine,
  type LabelSize,
  labelContent,
  parseLabelSize,
} from "../../../labels.js";
import { type KeyPress, letter, typed } from "../../core/keys.js";
import { send } from "../../core/program.js";
import type { AppMsg, Ctx, Hint, LabelsRequest, Step, TabMsg } from "../../core/types.js";
import { consoleConnection, consoleValue } from "../../tabs/spools/data.js";
import { pasted, textState } from "../../tabs/spools/local.js";
import { editText, moveCursor, plural, type TextState } from "../../ui/index.js";
import { loadLabelsCmd, makeLabelsCmd } from "./cmds.js";

/** Fields are shown in two columns of this many; ← and → jump between them. */
export const FIELD_ROWS = Math.ceil(LABEL_FIELDS.length / 2);
export const SIZE_ROW = LABEL_FIELDS.length;
export const PRINTER_ROW = SIZE_ROW + 1;
export const OUTPUT_ROW = PRINTER_ROW + 1;
export const MAKE_ROW = OUTPUT_ROW + 1;

/** Common label sizes, the default first; any other size can be typed on the Size row. */
export const COMMON_SIZES: readonly { size: string; detail?: string }[] = [
  { size: "57x32mm", detail: "2.25x1.25in thermal roll" },
  { size: "50x30mm" },
  { size: "50x25mm" },
  { size: "40x30mm" },
  { size: "62x29mm", detail: "Brother DK-11209" },
  { size: "2x1in", detail: "51x25mm" },
];

/** The last PDF choice: a path of your own, typed. */
export const OTHER_OUTPUT = "Other…";

/** What a size is typed with: digits, the x, and the unit. */
const SIZE_CHAR = /^[0-9.xXmMiInN]$/;

export interface LabelsModel {
  request: LabelsRequest;
  phase: "loading" | "ready" | "making";
  fields: LabelField[];
  size: string;
  /** A size typed (or remembered) that isn't a common one, kept in the ←/→ list. */
  customSize: string;
  /** The size was typed into since it was last chosen: typing then edits it instead of replacing it. */
  sizeTyped: boolean;
  printers: string[];
  /** "" when the labels are only written to a PDF. */
  printer: string;
  output: TextState;
  /** The PDF path remembered from last time, offered among the choices. */
  rememberedOutput: string;
  /** The PDF path is being typed (Other…): every key goes to it. */
  editing: boolean;
  /** The list of choices open for the Printer or Save PDF row. */
  picker: { row: number; cursor: number } | null;
  focus: number;
  error: string;
}

export type LabelsMsg =
  | { type: "labels/loaded"; settings: LabelSettings; printers: string[] }
  | { type: "labels/made" };

export function init(request: LabelsRequest, _ctx: Ctx): Step<LabelsModel> {
  return [
    {
      request,
      phase: "loading",
      fields: [],
      size: "",
      customSize: "",
      sizeTyped: false,
      printers: [],
      printer: "",
      output: textState(""),
      rememberedOutput: "",
      editing: false,
      picker: null,
      focus: MAKE_ROW,
      error: "",
    },
    [loadLabelsCmd()],
  ];
}

/** The sizes ←/→ cycles through: the common ones, then a custom one. */
export function sizeChoices(model: LabelsModel): string[] {
  const common = COMMON_SIZES.map((s) => s.size);
  return model.customSize && !common.includes(model.customSize)
    ? [...common, model.customSize]
    : common;
}

/** The printers to choose from; "" is Don't print. */
export function printerChoices(model: LabelsModel): string[] {
  return ["", ...model.printers];
}

function localDate(now: number): string {
  const date = new Date(now);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The PDF choices: none, today's file in your home, the one remembered, then a path of your own. */
export function outputChoices(model: LabelsModel, ctx: Ctx): string[] {
  const today = `~/labels-${localDate(ctx.now)}.pdf`;
  const choices = ["", today];
  const remembered = model.rememberedOutput.trim();
  if (remembered && remembered !== today) choices.push(remembered);
  const current = model.output.value.trim();
  if (current && !choices.includes(current)) choices.push(current);
  return [...choices, OTHER_OUTPUT];
}

function choicesFor(model: LabelsModel, row: number, ctx: Ctx): string[] {
  return row === PRINTER_ROW ? printerChoices(model) : outputChoices(model, ctx);
}

function currentChoice(model: LabelsModel, row: number): string {
  return row === PRINTER_ROW ? model.printer : model.output.value.trim();
}

/** The row to fix before labels can be made, else MAKE_ROW. */
export function firstMissing(model: LabelsModel): number {
  if (model.fields.length === 0) return 0;
  try {
    parseLabelSize(model.size);
  } catch {
    return SIZE_ROW;
  }
  if (!model.printer && !model.output.value.trim()) return PRINTER_ROW;
  return MAKE_ROW;
}

function expandHome(path: string, home: string): string {
  return path === "~" || path.startsWith("~/") ? join(home, path.slice(1)) : path;
}

/** What makeLabels needs, or why the form can't make labels yet. */
export function labelTarget(
  model: LabelsModel,
  home = homedir(),
): { target: LabelTarget } | { error: string } {
  if (model.fields.length === 0) return { error: "Pick at least one field" };
  let size: LabelSize;
  try {
    size = parseLabelSize(model.size);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  const output = model.output.value.trim();
  if (!model.printer && !output) return { error: "Choose a printer, a PDF path, or both" };
  return {
    target: {
      fields: model.fields,
      size,
      output: output ? expandHome(output, home) : "",
      printer: model.printer,
      printOptions: [],
    },
  };
}

export function labelSettingsOf(model: LabelsModel): LabelSettings {
  return {
    fields: model.fields,
    size: model.size,
    printer: model.printer,
    output: model.output.value,
  };
}

export interface LabelPreview {
  spoolId: string;
  /** The label carries the QR code. */
  qr: boolean;
  lines: LabelLine[];
}

/** The first requested spool's label with the chosen fields; null until that spool is loaded. */
export function labelPreview(model: LabelsModel, ctx: Ctx): LabelPreview | null {
  const data = consoleValue(ctx.resources.console);
  const id = model.request.spoolIds[0];
  const spool = data?.spools.find((s) => s.id === id);
  if (!data || !spool) return null;
  const content = labelContent(spool, new Map(data.filaments), model.fields);
  return { spoolId: spool.id, qr: content.qr !== null, lines: content.lines };
}

function toggle(fields: LabelField[], field: LabelField): LabelField[] {
  const on = fields.includes(field) ? fields.filter((f) => f !== field) : [...fields, field];
  return LABEL_FIELDS.map((f) => f.key).filter((key) => on.includes(key));
}

function cycle<T>(list: readonly T[], current: T, step: number): T {
  const index = list.indexOf(current);
  const from = index < 0 ? (step > 0 ? -1 : 0) : index;
  return list[(from + step + list.length) % list.length] ?? current;
}

const close: AppMsg = { type: "app/closeOverlay" };

function make(model: LabelsModel, ctx: Ctx): Step<LabelsModel> {
  const result = labelTarget(model);
  // The Make row already says what's missing: go there instead of repeating it.
  if ("error" in result) return [{ ...model, focus: firstMissing(model) }, []];
  const conn = consoleConnection(ctx.values);
  if (!conn)
    return [
      { ...model, error: "Labels read the spools from SpoolEase: set it up in Settings" },
      [],
    ];
  return [
    { ...model, phase: "making", error: "" },
    [makeLabelsCmd(conn, model.request.spoolIds, result.target, labelSettingsOf(model))],
  ];
}

function sizeKey(model: LabelsModel, key: KeyPress): LabelsModel | null {
  if (key.name === "left" || key.name === "right") {
    const size = cycle(sizeChoices(model), model.size, key.name === "right" ? 1 : -1);
    return { ...model, size, sizeTyped: false };
  }
  if (key.name === "backspace" || key.name === "delete") {
    const size = model.size.slice(0, -1);
    return { ...model, size, customSize: size, sizeTyped: true };
  }
  const text = typed(key);
  if (!text || ![...text].every((c) => SIZE_CHAR.test(c))) return null;
  const size = (model.sizeTyped ? model.size : "") + text;
  return { ...model, size, customSize: size, sizeTyped: true };
}

function openPicker(model: LabelsModel, row: number, ctx: Ctx): LabelsModel {
  const cursor = Math.max(0, choicesFor(model, row, ctx).indexOf(currentChoice(model, row)));
  return { ...model, picker: { row, cursor } };
}

function pickerKey(
  model: LabelsModel,
  picker: { row: number; cursor: number },
  key: KeyPress,
  ctx: Ctx,
): Step<LabelsModel> {
  if (key.name === "esc") return [{ ...model, picker: null }, []];
  const choices = choicesFor(model, picker.row, ctx);
  const moved = moveCursor(picker.cursor, key, choices.length, 8);
  if (moved !== null) return [{ ...model, picker: { ...picker, cursor: moved } }, []];
  if (key.name !== "enter" && key.name !== "space") return [model, []];
  const choice = choices[picker.cursor] ?? "";
  if (picker.row === PRINTER_ROW) return [{ ...model, printer: choice, picker: null }, []];
  if (choice === OTHER_OUTPUT) return [{ ...model, picker: null, editing: true }, []];
  return [{ ...model, picker: null, output: textState(choice) }, []];
}

function editKey(model: LabelsModel, key: KeyPress): Step<LabelsModel> {
  if (key.name === "esc") return [{ ...model, editing: false }, []];
  if (key.name === "enter") return [{ ...model, editing: false, focus: MAKE_ROW }, []];
  const edit = editText(model.output, key);
  if (!edit) return [model, []];
  const next = { ...model, output: { value: edit.value, cursor: edit.cursor } };
  // A pasted path ending in a line break moves on, as enter does.
  return [edit.submit ? { ...next, editing: false, focus: MAKE_ROW } : next, []];
}

function readyKey(model: LabelsModel, key: KeyPress, ctx: Ctx): Step<LabelsModel> {
  if (model.picker) return pickerKey(model, model.picker, key, ctx);
  if (model.editing) return editKey(model, key);
  if (key.name === "esc") return [model, [send(close)]];
  const moved = moveCursor(model.focus, key, MAKE_ROW + 1, 5);
  if (moved !== null) return [{ ...model, focus: moved }, []];
  const field = LABEL_FIELDS[model.focus]?.key;
  if (field) {
    if (key.name === "space" || key.name === "enter")
      return [{ ...model, fields: toggle(model.fields, field) }, []];
    const across =
      key.name === "right"
        ? model.focus + FIELD_ROWS
        : key.name === "left"
          ? model.focus - FIELD_ROWS
          : -1;
    if (key.name === "right" || key.name === "left")
      return across >= 0 && across < LABEL_FIELDS.length
        ? [{ ...model, focus: across }, []]
        : [model, []];
  } else if (model.focus === SIZE_ROW) {
    const sized = sizeKey(model, key);
    if (sized) return [sized, []];
  } else if (model.focus === PRINTER_ROW) {
    if (key.name === "enter" || key.name === "space")
      return [openPicker(model, PRINTER_ROW, ctx), []];
  } else if (model.focus === OUTPUT_ROW) {
    if (key.name === "enter" || key.name === "space")
      return [openPicker(model, OUTPUT_ROW, ctx), []];
    // Typing on the row starts a path of your own, replacing the choice.
    const text = typed(key);
    if (text && !key.name) return editKey({ ...model, editing: true, output: textState("") }, key);
    return [model, []];
  } else if (key.name === "enter") {
    return make(model, ctx);
  }
  if (letter(key) === "a") return make(model, ctx);
  return [model, []];
}

export function update(model: LabelsModel, msg: AppMsg | TabMsg, ctx: Ctx): Step<LabelsModel> {
  const m = msg as AppMsg | LabelsMsg;
  switch (m.type) {
    case "labels/loaded": {
      const { settings, printers } = m;
      const common = COMMON_SIZES.some((s) => s.size === settings.size);
      const next: LabelsModel = {
        ...model,
        phase: "ready",
        fields: settings.fields,
        size: settings.size,
        customSize: common ? "" : settings.size,
        sizeTyped: false,
        printers:
          settings.printer && !printers.includes(settings.printer)
            ? [...printers, settings.printer]
            : printers,
        printer: settings.printer,
        output: textState(settings.output),
        rememberedOutput: settings.output,
      };
      // The choices are remembered, so making labels is usually one key away; else start on what's missing.
      return [{ ...next, focus: firstMissing(next) }, []];
    }
    case "labels/made":
      return model.phase === "making" ? [model, [send(close)]] : [model, []];
    case "paste":
      // Text goes only into the text rows, so a pasted "a" never makes labels.
      return model.phase === "ready" &&
        !model.picker &&
        (model.focus === OUTPUT_ROW || model.focus === SIZE_ROW)
        ? readyKey({ ...model, error: "" }, pasted(m.text), ctx)
        : [model, []];
    case "key": {
      // While making, esc is ignored: closed, the overlay couldn't refuse q, which would cut the print short.
      if (model.phase === "making") return [model, []];
      if (model.phase !== "ready")
        return m.key.name === "esc" ? [model, [send(close)]] : [model, []];
      const [next, cmds] = readyKey({ ...model, error: "" }, m.key, ctx);
      return [next, cmds];
    }
    default:
      return [model, []];
  }
}

export function hints(model: LabelsModel, _ctx: Ctx): Hint[] {
  const closeHint: Hint = { keys: "esc", label: "close", primary: true };
  if (model.phase === "making") return [];
  if (model.phase !== "ready") return [closeHint];
  const move: Hint = { keys: "↑↓", label: "move", primary: true };
  if (model.picker)
    return [
      move,
      { keys: "enter", label: "choose", primary: true },
      { keys: "esc", label: "back", primary: true },
    ];
  if (model.editing)
    return [
      { keys: "type", label: "PDF path", primary: true },
      { keys: "enter", label: "done", primary: true },
      { keys: "esc", label: "keep it", primary: true },
    ];
  // a is offered only once labels can be made; until then the Make row says what's missing.
  const makeHints: Hint[] =
    "error" in labelTarget(model) ? [] : [{ keys: "a", label: "make labels", primary: true }];
  if (LABEL_FIELDS[model.focus])
    return [
      move,
      { keys: "←→", label: "column" },
      { keys: "space", label: "tick", primary: true },
      ...makeHints,
      closeHint,
    ];
  switch (model.focus) {
    case SIZE_ROW:
      return [
        move,
        { keys: "←→", label: "common sizes", primary: true },
        { keys: "type", label: "a size like 2.25x1.25in" },
        ...makeHints,
        closeHint,
      ];
    case PRINTER_ROW:
      return [
        move,
        { keys: "enter", label: "choose printer", primary: true },
        ...makeHints,
        closeHint,
      ];
    case OUTPUT_ROW:
      return [
        move,
        { keys: "enter", label: "choose", primary: true },
        { keys: "type", label: "a path of your own" },
        closeHint,
      ];
    default: {
      const missing = MISSING_LABELS[firstMissing(model)];
      return [move, { keys: "enter", label: missing ?? "make labels", primary: true }, closeHint];
    }
  }
}

/** What enter on Make does while something is missing: go to that row. */
const MISSING_LABELS: Record<number, string> = {
  0: "pick a field",
  [SIZE_ROW]: "fix the size",
  [PRINTER_ROW]: "choose a printer",
};

/** What's being made right now, else null: the shell won't quit meanwhile. */
export function busy(model: LabelsModel): string | null {
  return model.phase === "making"
    ? `Making ${plural(model.request.spoolIds.length, "label")}`
    : null;
}
