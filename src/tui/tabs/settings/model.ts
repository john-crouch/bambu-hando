// ABOUTME: The Settings tab's model and pure update: pages of rows, the list or text field a row opens, and the test.
// ABOUTME: Every change applies at once through app/values; label settings, the console and its key (keyring) are saved too.

import type { SavedConsole } from "../../../tuiSettings.js";
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
import type { FormValues } from "../../core/values.js";
import { editText, moveCursor, type TextEdit } from "../../ui/index.js";
import {
  forgetKey,
  type LoadWhat,
  loadFolders,
  loadLabelPrinters,
  loadLabels,
  loadPrinters,
  loadStoredKey,
  saveConsole,
  saveKey,
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
  focusTarget,
  type ListView,
  listFor,
  OTHER,
  PAGE_FIELDS,
  PAGES,
  type PageId,
  PORT_ERROR,
  type Sources,
  shownItems,
  textFor,
  tickItem,
} from "./fields.js";
import { type Typed, typeAheadJump } from "./keys.js";
import { listRows } from "./layout.js";

export type Open =
  | ({ kind: "list"; field: FieldId; cursor: number; typed?: Typed } & ListView)
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
  /** Whether the lists that cost a moment to read (BambuStudio's printers, CUPS) have been asked for. */
  asked: boolean;
}

/** What each list is made from, beyond the session's values. */
const LIST_SOURCES: Partial<Record<FieldId, LoadWhat>> = {
  presetFolder: "folders",
  printerPreset: "printers",
  labelPrinter: "labelPrinters",
};

function init(_ctx: Ctx): Step<SettingsModel> {
  return [
    {
      page: "bambu",
      cursors: { bambu: 0, spoolease: 0, labels: 0, import: 0 },
      open: null,
      error: "",
      test: { state: "idle" },
      testSeq: 0,
      asked: false,
      folders: { state: "loading" },
      printers: { state: "loading" },
      labelPrinters: { state: "loading" },
      labels: { state: "loading" },
    },
    // The printer lists wait for the tab's first key, so starting the TUI doesn't read them.
    [loadFolders(), loadLabels()],
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
    // Shown at once; the save merges the change into labels.json as it is then and reports back.
    const labels = { ...current, ...change.labels };
    return step({ ...model, labels: { state: "ready", value: labels } }, saveLabels(change.labels));
  }
  const values = change.values;
  const cmds: Step<SettingsModel>[1] = [send<AppMsg>({ type: "app/values", values })];
  if (values.printerPreset !== undefined && values.printerPreset !== ctx.values.printerPreset)
    cmds.push(savePrinters(printerList(values.printerPreset)));
  const console = consoleChange(values, ctx);
  if (console) cmds.push(saveConsole(console));
  // A session started with --skip-spoolease never read the keyring: turning SpoolEase on reads it, unless the
  // session already has a key (a flag's, the variable's or BambuStudio's).
  if (values.skipSpoolease === false && ctx.values.skipSpoolease && !ctx.values.securityKey)
    cmds.push(loadStoredKey(ctx.values.host.trim()));
  const connectionChanged = CONNECTION_FIELDS.some(
    (key) => key in values && values[key] !== ctx.values[key],
  );
  const next = connectionChanged
    ? { ...model, test: { state: "idle" } as TestState, testSeq: model.testSeq + 1 }
    : model;
  return [next, cmds];
}

/**
 * The whole console for tui.json (the host shown, its port and HTTPS) when a change sets the host, port, HTTPS or key
 * anew, so what's saved stays bound to one host; null otherwise. The key itself goes to the keyring, never here.
 */
function consoleChange(values: Partial<FormValues>, ctx: Ctx): SavedConsole | null {
  const changed = (["host", "port", "https", "securityKey"] as const).some(
    (key) => values[key] !== undefined && values[key] !== ctx.values[key],
  );
  return changed ? savedConsole({ ...ctx.values, ...values }) : null;
}

/** The console as Settings shows it, as tui.json keeps it. */
function savedConsole(values: FormValues): SavedConsole {
  const host = values.host.trim();
  const port = validPort(values.port);
  return { ...(host ? { host } : {}), ...(port === null ? {} : { port }), https: values.https };
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
  // Ticked printers first, so the few in use aren't lost among dozens; label fields keep their print order.
  const view: ListView = field === "printerPreset" ? { pinned: list.ticked } : {};
  const cursor = Math.max(
    0,
    shownItems(list, view).findIndex((item) => list.ticked.includes(item.value)),
  );
  const reload =
    field === "presetFolder"
      ? [loadFolders()]
      : field === "labelPrinter"
        ? [loadLabelPrinters()]
        : [];
  return step({ ...model, open: { kind: "list", field, cursor, ...view } }, ...reload);
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

/** Typing into an open list's / filter: enter keeps the filter and goes back to the list, esc clears it. */
function filterKey(
  model: SettingsModel,
  open: Extract<Open, { kind: "list" }>,
  key: KeyPress,
): Step<SettingsModel> | null {
  const filter = open.filter ?? { value: "", cursor: 0 };
  if (key.name === "esc") return step({ ...model, open: withFilter(open, null) });
  if (key.name === "enter") return step({ ...model, open: { ...open, filtering: false } });
  if (key.name === "up" || key.name === "down") return null;
  const edited = editText(filter, key);
  if (!edited) return step(model);
  const next = withFilter(open, { value: edited.value, cursor: edited.cursor });
  const leaving = edited.submit ? { filtering: false } : {};
  return step({ ...model, open: { ...next, ...leaving, cursor: 0 } });
}

/** The list with this filter (null: none), still typing into it unless cleared. */
function withFilter(
  open: Extract<Open, { kind: "list" }>,
  filter: ListView["filter"] | null,
): Extract<Open, { kind: "list" }> {
  const { filter: _old, filtering: _was, ...rest } = open;
  return filter ? { ...rest, filter, filtering: true } : { ...rest, cursor: 0 };
}

function listKey(
  model: SettingsModel,
  open: Extract<Open, { kind: "list" }>,
  key: KeyPress,
  ctx: Ctx,
): Step<SettingsModel> {
  if (open.filtering) {
    const filtered = filterKey(model, open, key);
    if (filtered) return filtered;
  }
  const list = listFor(open.field, ctx, model);
  const items = shownItems(list, open);
  const close = { ...model, open: null };
  if (key.name === "esc")
    return open.filter?.value ? step({ ...model, open: withFilter(open, null) }) : step(close);
  if (key.input === "/" && !key.ctrl && !key.meta)
    return step({
      ...model,
      open: { ...open, filter: open.filter ?? { value: "", cursor: 0 }, filtering: true },
    });
  const moved = moveCursor(
    open.cursor,
    key,
    items.length,
    listRows(ctx, model.page, open.filter !== undefined),
  );
  if (moved !== null) return step({ ...model, open: { ...open, cursor: moved } });
  const item = items[open.cursor];
  if (list.multi) {
    if (key.name === "enter") return step(close);
    if (key.name === "space" && item) {
      const result = tickItem(open.field, item.value, list);
      if ("error" in result) return step({ ...model, error: result.error });
      const [next, cmds] = apply(model, result.change, ctx);
      // Unticking a value the list only showed because it was ticked removes its row.
      const after = shownItems(listFor(open.field, valuesAfter(ctx, result.change), next), open);
      const cursor = Math.min(open.cursor, Math.max(0, after.length - 1));
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
    const labels = items.map((i) => i.label);
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
  const [applied, cmds] = apply({ ...edited, open: null }, result.change, ctx);
  if (open.field !== "securityKey" || !("values" in result.change)) return [applied, cmds];
  // Saved on every commit, changed or not, so a key that came from BambuStudio or a flag can be kept.
  const key = result.change.values.securityKey ?? "";
  // The key stays bound to the console shown: an unchanged key is saved again, and so is its console.
  const console = consoleChange(result.change.values, ctx)
    ? []
    : [saveConsole(savedConsole({ ...ctx.values, ...result.change.values }))];
  return [applied, [...cmds, ...console, key ? saveKey(key) : forgetKey()]];
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
  // esc has nothing to go back to on a page: ← is the way to the page before.
  if (key.name === "left") return toPage(index - 1);
  if (key.name === "right") return toPage(index + 1);
  const fields = pageFieldIds(model.page);
  const moved = moveCursor(model.cursors[model.page], key, fields.length, fields.length);
  if (moved !== null) return step({ ...model, cursors: { ...model.cursors, [model.page]: moved } });
  if (key.name === "enter" || key.name === "space") return openRow(model, ctx);
  if (model.page === "spoolease" && letter(key) === "t") return startTest(model, ctx);
  return step(model);
}

function update(model: SettingsModel, msg: AppMsg | TabMsg, ctx: Ctx): Step<SettingsModel> {
  switch (msg.type) {
    case "key": {
      const key = (msg as Extract<AppMsg, { type: "key" }>).key;
      if (model.asked) return keyStep({ ...model, error: "" }, key, ctx);
      const [next, cmds] = keyStep({ ...model, error: "", asked: true }, key, ctx);
      return [next, [loadPrinters(), loadLabelPrinters(), ...cmds]];
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
      const next = { ...model, [what]: loaded } as SettingsModel;
      // A list opened before its items arrived: put the cursor on the current value, now it's listed.
      const open = next.open;
      if (!previous && open?.kind === "list" && LIST_SOURCES[open.field] === what) {
        const list = listFor(open.field, ctx, next);
        const cursor = shownItems(list, open).findIndex((item) => list.ticked.includes(item.value));
        if (cursor >= 0) return step({ ...next, open: { ...open, cursor } });
      }
      return step(next);
    }
    case "settings/storedKey": {
      // Only for the console it was read for, and only while nothing else has given the session a key.
      const { values } = ctx;
      if (values.skipSpoolease || values.securityKey || values.host.trim() !== msg.host)
        return step(model);
      const key = String(msg.key);
      return [
        { ...model, test: { state: "idle" }, testSeq: model.testSeq + 1 },
        [send<AppMsg>({ type: "app/values", values: { securityKey: key } })],
      ];
    }
    case "settings/tested": {
      if (msg.seq !== model.testSeq) return step(model);
      return step({
        ...model,
        test: { state: msg.ok ? "ok" : "failed", text: String(msg.text) },
      });
    }
    case "app/switchTab": {
      // labels.json may have changed meanwhile (the labels overlay saves there too).
      const focus = (msg as Extract<AppMsg, { type: "app/switchTab" }>).focus;
      const target = focus ? focusTarget(focus) : null;
      if (!target) return step(model, loadLabels());
      const cursors =
        target.row === undefined ? model.cursors : { ...model.cursors, [target.page]: target.row };
      return step({ ...model, page: target.page, cursors, open: null, error: "" }, loadLabels());
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
  if (open?.kind === "list" && open.filtering)
    return [
      { keys: "↑↓", label: "move" },
      { keys: "enter", label: "done", primary: true },
      { keys: "esc", label: "clear filter", primary: true },
    ];
  if (open?.kind === "list") {
    const close: Hint = open.filter?.value
      ? { keys: "esc", label: "clear filter", primary: true }
      : { keys: "esc", label: "close" };
    return fieldKind(open.field) === "multi"
      ? [
          { keys: "↑↓", label: "move" },
          { keys: "space", label: "tick", primary: true },
          { keys: "enter", label: "done", primary: true },
          { keys: "/", label: "filter" },
          close,
        ]
      : [
          { keys: "↑↓", label: "move" },
          { keys: "enter", label: "choose", primary: true },
          { keys: "/", label: "filter" },
          close,
        ];
  }
  const field = focusedField(model);
  return [
    { keys: "↑↓", label: "move" },
    ...(field
      ? [{ keys: "enter", label: ACTION[fieldKind(field)] ?? "change", primary: true }]
      : []),
    ...(model.page === "spoolease" ? [{ keys: "t", label: "test connection", primary: true }] : []),
    { keys: "←→", label: "pages" },
  ];
}

function capturesText(model: SettingsModel): boolean {
  return (
    model.open?.kind === "text" || (model.open?.kind === "list" && Boolean(model.open.filtering))
  );
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
      keys: "t",
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
