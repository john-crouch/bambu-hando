// ABOUTME: The Settings tab's model and pure update: pages of rows, the list or text field a row opens, and the test.
// ABOUTME: Every change applies at once through app/values (label settings are saved instead); the key is never shown.

import type { LabelSettings } from "../../../labelSettings.js";
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
import { editText, moveCursor, type TextEdit } from "../../ui/index.js";
import {
  type LoadWhat,
  loadFolders,
  loadLabelPrinters,
  loadLabels,
  loadPrinters,
  saveLabels,
  savePrinters,
  testConnection,
} from "./cmds.js";
import { connectionOf, printerList, validPort } from "./connection.js";
import {
  type Change,
  CONNECTION_FIELDS,
  chooseItem,
  commitText,
  type FieldId,
  fieldKind,
  listFor,
  OTHER,
  PAGE_FIELDS,
  PAGES,
  type PageId,
  PORT_ERROR,
  type Sources,
  textFor,
  tickItem,
} from "./fields.js";
import { type Typed, typeAheadJump } from "./keys.js";

export type Open =
  | { kind: "list"; field: FieldId; cursor: number; typed?: Typed }
  | { kind: "text"; field: FieldId; value: string; cursor: number };

export type TestState =
  | { state: "idle" }
  | { state: "testing" }
  | { state: "ok" | "failed"; text: string };

export interface SettingsModel extends Sources {
  page: PageId;
  /** Each page's row cursor, kept while another page is shown. */
  cursors: Record<PageId, number>;
  /** The list or text field the focused row opened. */
  open: Open | null;
  /** Why the last change was refused; cleared by the next key. */
  error: string;
  /** The last connection test, for the settings it was run with. */
  test: TestState;
  /** Bumped by every test and every connection change, so a late answer about older settings is dropped. */
  testSeq: number;
}

/** Rows a list moves by on pgup/pgdn: about the body less its chrome. */
function pageSize(ctx: Ctx): number {
  return Math.max(1, ctx.bodyRows - 6);
}

function init(_ctx: Ctx): Step<SettingsModel> {
  return [
    {
      page: "bambu",
      cursors: { bambu: 0, spoolease: 0, labels: 0, import: 0 },
      open: null,
      error: "",
      test: { state: "idle" },
      testSeq: 0,
      folders: { state: "loading" },
      printers: { state: "loading" },
      labelPrinters: { state: "loading" },
      labels: { state: "loading" },
    },
    [loadFolders(), loadPrinters(), loadLabels(), loadLabelPrinters()],
  ];
}

const step = (model: SettingsModel, ...cmds: Step<SettingsModel>[1]): Step<SettingsModel> => [
  model,
  cmds,
];

function focusedField(model: SettingsModel): FieldId | undefined {
  return pageFieldIds(model.page)[model.cursors[model.page]];
}

function pageFieldIds(page: PageId): FieldId[] {
  return PAGE_FIELDS[page].map((field) => field.id);
}

/** Applies a change: values go to the shell, label settings are saved; printers are remembered. */
function apply(model: SettingsModel, change: Change, ctx: Ctx): Step<SettingsModel> {
  if ("labels" in change) {
    const current = model.labels.value;
    if (!current) return step({ ...model, error: "Still reading the label settings" });
    const labels: LabelSettings = { ...current, ...change.labels };
    return step({ ...model, labels: { state: "ready", value: labels } }, saveLabels(labels));
  }
  const values = change.values;
  const cmds: Step<SettingsModel>[1] = [send<AppMsg>({ type: "app/values", values })];
  if (values.printerPreset !== undefined && values.printerPreset !== ctx.values.printerPreset)
    cmds.push(savePrinters(printerList(values.printerPreset)));
  const connectionChanged = CONNECTION_FIELDS.some(
    (key) => key in values && values[key] !== ctx.values[key],
  );
  const next = connectionChanged
    ? { ...model, test: { state: "idle" } as TestState, testSeq: model.testSeq + 1 }
    : model;
  return [next, cmds];
}

function openRow(model: SettingsModel, ctx: Ctx): Step<SettingsModel> {
  const field = focusedField(model);
  if (!field) return step(model);
  const kind = fieldKind(field);
  if (kind === "toggle") {
    const key = field as "overwritePresets" | "https" | "skipSpoolease" | "createSpools";
    return apply(model, { values: { [key]: !ctx.values[key] } }, ctx);
  }
  const labelField = field.startsWith("label");
  if (labelField && !model.labels.value)
    return step({ ...model, error: "Still reading the label settings" });
  if (kind === "text" || kind === "secret") {
    const value = textFor(field, ctx, model);
    return step({ ...model, open: { kind: "text", field, value, cursor: value.length } });
  }
  const list = listFor(field, ctx, model);
  const cursor = Math.max(
    0,
    list.items.findIndex((item) => list.ticked.includes(item.value)),
  );
  const reload =
    field === "presetFolder"
      ? [loadFolders()]
      : field === "labelPrinter"
        ? [loadLabelPrinters()]
        : [];
  return step({ ...model, open: { kind: "list", field, cursor } }, ...reload);
}

function startTest(model: SettingsModel, ctx: Ctx): Step<SettingsModel> {
  // A test works with SpoolEase skipped too: it's how you find out the console is there before turning it on.
  const values = { ...ctx.values, skipSpoolease: false };
  const connection = connectionOf(values);
  if (!connection) {
    const error = !values.host.trim()
      ? "Type the console's host first"
      : !values.securityKey
        ? "Set the security key first"
        : validPort(values.port) === null
          ? PORT_ERROR
          : "";
    return step({ ...model, error });
  }
  const seq = model.testSeq + 1;
  return step(
    { ...model, test: { state: "testing" }, testSeq: seq },
    testConnection(connection, seq),
  );
}

function listKey(
  model: SettingsModel,
  open: Extract<Open, { kind: "list" }>,
  key: KeyPress,
  ctx: Ctx,
): Step<SettingsModel> {
  const list = listFor(open.field, ctx, model);
  const close = { ...model, open: null };
  if (key.name === "esc") return step(close);
  const moved = moveCursor(open.cursor, key, list.items.length, pageSize(ctx));
  if (moved !== null) return step({ ...model, open: { ...open, cursor: moved } });
  const item = list.items[open.cursor];
  if (list.multi) {
    if (key.name === "enter") return step(close);
    if (key.name === "space" && item) {
      const result = tickItem(open.field, item.value, list);
      if ("error" in result) return step({ ...model, error: result.error });
      const [next, cmds] = apply(model, result.change, ctx);
      // Unticking a value the list only showed because it was ticked removes its row.
      const after = listFor(open.field, valuesAfter(ctx, result.change), next);
      const cursor = Math.min(open.cursor, Math.max(0, after.items.length - 1));
      return [{ ...next, open: { ...open, cursor } }, cmds];
    }
  } else if ((key.name === "enter" || key.name === "space") && item) {
    if (item.value === OTHER) {
      const value = textFor(open.field, ctx, model);
      return step({
        ...model,
        open: { kind: "text", field: open.field, value, cursor: value.length },
      });
    }
    return apply(close, chooseItem(open.field, item.value), ctx);
  }
  const typedLetter = letter(key);
  if (typedLetter) {
    const labels = list.items.map((i) => i.label);
    const jump = typeAheadJump(labels, open.cursor, typedLetter, open.typed, ctx.now);
    return step({ ...model, open: { ...open, ...jump } });
  }
  return step(model);
}

function valuesAfter(ctx: Ctx, change: Change): Ctx {
  return "values" in change ? { ...ctx, values: { ...ctx.values, ...change.values } } : ctx;
}

function textEdited(
  model: SettingsModel,
  open: Extract<Open, { kind: "text" }>,
  next: TextEdit,
  ctx: Ctx,
): Step<SettingsModel> {
  const edited = { ...model, open: { ...open, value: next.value, cursor: next.cursor } };
  if (!next.submit) return step(edited);
  const result = commitText(open.field, next.value);
  if ("error" in result) return step({ ...edited, error: result.error });
  return apply({ ...edited, open: null }, result.change, ctx);
}

function keyStep(model: SettingsModel, key: KeyPress, ctx: Ctx): Step<SettingsModel> {
  const open = model.open;
  if (open?.kind === "text") {
    if (key.name === "esc") return step({ ...model, open: null });
    if (key.name === "enter") return textEdited(model, open, { ...open, submit: true }, ctx);
    const next = editText(open, key);
    return next ? textEdited(model, open, next, ctx) : step(model);
  }
  if (open?.kind === "list") return listKey(model, open, key, ctx);

  const index = PAGES.findIndex((p) => p.id === model.page);
  const toPage = (to: number): Step<SettingsModel> => {
    const page = PAGES[Math.max(0, Math.min(to, PAGES.length - 1))];
    return step(page ? { ...model, page: page.id } : model);
  };
  if (key.name === "left" || key.name === "esc") return toPage(index - 1);
  if (key.name === "right") return toPage(index + 1);
  const fields = pageFieldIds(model.page);
  const moved = moveCursor(model.cursors[model.page], key, fields.length, pageSize(ctx));
  if (moved !== null) return step({ ...model, cursors: { ...model.cursors, [model.page]: moved } });
  if (key.name === "enter" || key.name === "space") return openRow(model, ctx);
  if (model.page === "spoolease" && letter(key) === "t") return startTest(model, ctx);
  return step(model);
}

function update(model: SettingsModel, msg: AppMsg | TabMsg, ctx: Ctx): Step<SettingsModel> {
  switch (msg.type) {
    case "key": {
      const key = (msg as Extract<AppMsg, { type: "key" }>).key;
      return keyStep({ ...model, error: "" }, key, ctx);
    }
    case "paste": {
      const open = model.open;
      if (open?.kind !== "text") return step(model);
      const text = (msg as Extract<AppMsg, { type: "paste" }>).text;
      // A paste is a typed burst: a newline in it saves what came before.
      const burst = { input: text, ctrl: false, shift: false, meta: false };
      const next = editText(open, burst);
      return next ? textEdited({ ...model, error: "" }, open, next, ctx) : step(model);
    }
    case "settings/loaded": {
      const what = msg.what as LoadWhat;
      const previous = model[what].value;
      const loaded =
        typeof msg.error === "string"
          ? { state: "failed", error: msg.error, ...(previous ? { value: previous } : {}) }
          : { state: "ready", value: msg.value };
      return step({ ...model, [what]: loaded });
    }
    case "settings/tested": {
      if (msg.seq !== model.testSeq) return step(model);
      return step({
        ...model,
        test: { state: msg.ok ? "ok" : "failed", text: String(msg.text) },
      });
    }
    case "settings/page": {
      const page = PAGES.find((p) => p.id === msg.page)?.id ?? model.page;
      return step(
        { ...model, page, open: null, error: "" },
        send<AppMsg>({ type: "app/switchTab", tab: "settings" }),
      );
    }
    case "settings/test": {
      const [next, cmds] = startTest({ ...model, page: "spoolease", open: null, error: "" }, ctx);
      return [next, [send<AppMsg>({ type: "app/switchTab", tab: "settings" }), ...cmds]];
    }
    default:
      return step(model);
  }
}

const ACTION: Record<string, string> = {
  toggle: "switch",
  choice: "choose",
  multi: "choose",
  text: "edit",
  secret: "edit",
};

function hints(model: SettingsModel, _ctx: Ctx): Hint[] {
  const open = model.open;
  if (open?.kind === "text")
    return [
      { keys: "enter", label: "save", primary: true },
      { keys: "esc", label: "cancel", primary: true },
    ];
  if (open?.kind === "list")
    return fieldKind(open.field) === "multi"
      ? [
          { keys: "↑↓", label: "move" },
          { keys: "space", label: "tick", primary: true },
          { keys: "enter", label: "done", primary: true },
          { keys: "esc", label: "close" },
        ]
      : [
          { keys: "↑↓", label: "move" },
          { keys: "enter", label: "choose", primary: true },
          { keys: "esc", label: "close" },
        ];
  const field = focusedField(model);
  return [
    { keys: "↑↓", label: "move" },
    ...(field
      ? [{ keys: "enter", label: ACTION[fieldKind(field)] ?? "change", primary: true }]
      : []),
    ...(model.page === "spoolease" ? [{ keys: "t", label: "test connection", primary: true }] : []),
    { keys: "←→", label: "pages" },
    ...(model.page === PAGES[0]?.id ? [] : [{ keys: "esc", label: "back" }]),
  ];
}

function capturesText(model: SettingsModel): boolean {
  return model.open?.kind === "text";
}

function commands(_model: SettingsModel, _ctx: Ctx): PaletteCommand[] {
  return [
    ...PAGES.map((page) => ({
      title: `Settings: ${page.title}`,
      msg: toTab("settings", { type: "settings/page", page: page.id }),
    })),
    {
      title: "Test the SpoolEase connection",
      detail: "Settings",
      msg: toTab("settings", { type: "settings/test" }),
    },
  ];
}

/** The Settings tab without its view (the view joins it in index.ts). */
export const settingsLogic: Omit<TabModule<SettingsModel>, "View"> = {
  id: "settings",
  title: "Settings",
  init,
  update,
  hints,
  capturesText,
  commands,
};
