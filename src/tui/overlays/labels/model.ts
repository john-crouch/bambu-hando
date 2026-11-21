// ABOUTME: The labels overlay's model and pure update: which fields print, the label size, the printer and the PDF path.
// ABOUTME: Also the live preview of the first spool's label, so you see what prints before making labels.

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
import {
  editText,
  moveCursor,
  pasted,
  type TextState,
  textState,
} from "../../tabs/spools/local.js";
import { loadLabelsCmd, makeLabelsCmd } from "./cmds.js";

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
      // The choices are remembered, so making labels is usually one key away.
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

/** The printers ←/→ cycles through; "" is Don't print. */
export function printerChoices(model: LabelsModel): string[] {
  return ["", ...model.printers];
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
  if ("error" in result) return [{ ...model, error: result.error }, []];
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

function readyKey(model: LabelsModel, key: KeyPress, ctx: Ctx): Step<LabelsModel> {
  if (key.name === "esc") return [model, [send(close)]];
  const moved = moveCursor(model.focus, key, MAKE_ROW + 1, 5);
  // On the PDF path, home and end move in the text.
  if (
    moved !== null &&
    !(model.focus === OUTPUT_ROW && (key.name === "home" || key.name === "end"))
  )
    return [{ ...model, focus: moved }, []];
  const field = LABEL_FIELDS[model.focus]?.key;
  if (field) {
    if (key.name === "space" || key.name === "enter")
      return [{ ...model, fields: toggle(model.fields, field) }, []];
  } else if (model.focus === SIZE_ROW) {
    const sized = sizeKey(model, key);
    if (sized) return [sized, []];
  } else if (model.focus === PRINTER_ROW) {
    const step = key.name === "left" ? -1 : key.name === "right" || key.name === "space" ? 1 : 0;
    if (key.name === "enter") return make(model, ctx);
    if (step) return [{ ...model, printer: cycle(printerChoices(model), model.printer, step) }, []];
  } else if (model.focus === OUTPUT_ROW) {
    if (key.name === "enter") return [{ ...model, focus: MAKE_ROW }, []];
    const output = editText(model.output, key);
    return output ? [{ ...model, output }, []] : [model, []];
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
      return [
        {
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
        },
        [],
      ];
    }
    case "labels/made":
      return model.phase === "making" ? [model, [send(close)]] : [model, []];
    case "paste":
      // Text goes only into the text rows, so a pasted "a" never makes labels.
      return model.phase === "ready" && (model.focus === OUTPUT_ROW || model.focus === SIZE_ROW)
        ? readyKey({ ...model, error: "" }, pasted(m.text), ctx)
        : [model, []];
    case "key": {
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
  if (model.phase !== "ready") return [closeHint];
  const move: Hint = { keys: "↑↓", label: "move", primary: true };
  const makeHint: Hint = { keys: "a", label: "make labels", primary: true };
  if (LABEL_FIELDS[model.focus])
    return [move, { keys: "space", label: "tick", primary: true }, makeHint, closeHint];
  switch (model.focus) {
    case SIZE_ROW:
      return [
        move,
        { keys: "←→", label: "common sizes", primary: true },
        { keys: "type", label: "a size like 2.25x1.25in" },
        makeHint,
        closeHint,
      ];
    case PRINTER_ROW:
      return [move, { keys: "←→", label: "printer", primary: true }, makeHint, closeHint];
    case OUTPUT_ROW:
      return [
        move,
        { keys: "type", label: "PDF path", primary: true },
        { keys: "enter", label: "done", primary: true },
        closeHint,
      ];
    default:
      return [move, { keys: "enter", label: "make labels", primary: true }, makeHint, closeHint];
  }
}
