// ABOUTME: The Spools tab's model and pure update: the console's spools as a list, and its count, scan and filament dialogs.
// ABOUTME: Keys and the tab's own messages go in; the next model and the commands to run come out.

import { type BarcodeFilament, normalizeBarcode } from "../../../barcodes.js";
import { type CopyableFilament, copyableFilaments } from "../../../spoolCopies.js";
import type { SpoolEaseWrite } from "../../../spoolease.js";
import {
  INVENTORY_SORTS,
  type InventoryRow,
  type InventorySort,
  inventoryRows,
} from "../../../spoolInventory.js";
import { checkCounts } from "../../../syncCheck.js";
import { type KeyPress, letter, typed } from "../../core/keys.js";
import { type Cmd, send } from "../../core/program.js";
import {
  type AppMsg,
  type ConsoleData,
  type Ctx,
  type Hint,
  type PaletteCommand,
  type Resource,
  type StartOptions,
  type Step,
  type TabMsg,
  toTab,
} from "../../core/types.js";
import { editText, moveCursor, plural, type TextState, typeAhead } from "../../ui/index.js";
import { addCopiesCmd, loadBarcodesCmd, rememberBarcodeCmd } from "./cmds.js";
import { consoleConnection, consoleUrl, consoleValue } from "./data.js";
import { pasted, textState } from "./local.js";

/** The most copies one dialog adds. */
export const MAX_COPIES = 8;
/** Body lines the list panel doesn't give to rows: its borders, the summary line and the filter line. */
const LIST_CHROME = 4;
/** From this many body columns the detail panel sits beside the list; below, enter opens it instead. */
export const WIDE_COLUMNS = 90;

export function isWide(ctx: Ctx): boolean {
  return ctx.bodyColumns >= WIDE_COLUMNS;
}

/** The compact detail's height under the list, borders included. */
export const COMPACT_DETAIL = 5;
/** Below this many body rows a narrow terminal keeps the whole height for the list. */
const STACK_ROWS = 16;

/** Narrow but tall enough: the highlighted spool's compact detail sits under the list. */
export function stacksDetail(ctx: Ctx): boolean {
  return !isWide(ctx) && ctx.bodyRows >= STACK_ROWS;
}

/** A barcode to scan or type. pending holds a scan made before the known barcodes were read. */
export interface ScanDialog {
  kind: "scan";
  text: TextState;
  error: string;
  pending: string | null;
}

/** A barcode bambu-hando knows, whose filament the console still has spools of. */
export interface KnownDialog {
  kind: "known";
  barcode: string;
  filament: CopyableFilament;
  /** 0: more spools of it; 1: a different filament. */
  cursor: number;
}

/** Which filament a barcode is: a new one, or one whose filament has no spool on the console now (gone). */
export interface ChooseDialog {
  kind: "choose";
  barcode: string;
  gone: BarcodeFilament | null;
  filaments: CopyableFilament[];
  cursor: number;
  saving: boolean;
}

/** How many copies of a filament's newest spool to add, then the results as they come. */
export interface CountDialog {
  kind: "count";
  filament: CopyableFilament;
  count: number;
  phase: "choose" | "running" | "done";
  results: SpoolEaseWrite[];
  /** Why nothing was added (a rejected key, an unreachable console). */
  error: string;
  run: number;
  /** Where esc goes: the scan that led here, or the list. */
  back: ScanDialog | null;
  /** The console the copies go to, shown before applying. */
  url: string;
}

export type Dialog = ScanDialog | KnownDialog | ChooseDialog | CountDialog;

/** What a copy run was, kept until it reports (its dialog may be closed by then). */
interface RunInfo {
  name: string;
  count: number;
  url: string;
}

export interface SpoolsModel {
  /** The highlighted spool, kept across reloads, filters and sorts; cursor is the fallback place. */
  cursorId: string | null;
  cursor: number;
  filter: TextState;
  /** The filter has focus: typing goes to it. */
  filtering: boolean;
  sort: InventorySort;
  /** Ticked spool IDs, in the order ticked. */
  ticked: string[];
  /** The detail panel opened with enter, for terminals too narrow to show it beside the list. */
  detailOpen: boolean;
  dialog: Dialog | null;
  /** Barcodes bambu-hando knows; null until read. */
  barcodes: ReadonlyMap<string, BarcodeFilament> | null;
  nextRun: number;
  runs: Readonly<Record<number, RunInfo>>;
}

export type SpoolsMsg =
  | { type: "spools/barcodes"; barcodes: ReadonlyMap<string, BarcodeFilament> }
  | { type: "spools/remembered"; barcode: string; filament: BarcodeFilament }
  | { type: "spools/rememberFailed"; barcode: string; error: string }
  | { type: "spools/copy"; run: number; result: SpoolEaseWrite }
  | {
      type: "spools/copiesDone";
      run: number;
      results: SpoolEaseWrite[];
      error: string;
      exitCode?: 1 | 2;
    }
  | { type: "spools/command"; action: SpoolsAction };

export type SpoolsAction = "reload" | "scan" | "labels" | "more" | "sort";

/** What the tab body shows, from the settings and the console resource. */
export type SpoolsScreen =
  | { kind: "unset" }
  | { kind: "loading" }
  | { kind: "failed"; error: string }
  | { kind: "empty" }
  | { kind: "list"; data: ConsoleData; reloading: boolean; error?: string };

export function spoolsScreen(ctx: Ctx): SpoolsScreen {
  if (!consoleConnection(ctx.values)) return { kind: "unset" };
  const resource = ctx.resources.console;
  const data = consoleValue(resource);
  if (!data) {
    return resource.state === "failed"
      ? { kind: "failed", error: resource.error }
      : { kind: "loading" };
  }
  if (data.spools.length === 0) return { kind: "empty" };
  const reloading = resource.state === "loading";
  return resource.state === "failed"
    ? { kind: "list", data, reloading, error: resource.error }
    : { kind: "list", data, reloading };
}

export function init(ctx: Ctx, _start: StartOptions): Step<SpoolsModel> {
  const model: SpoolsModel = {
    cursorId: null,
    cursor: 0,
    filter: textState(""),
    filtering: false,
    sort: "newest",
    ticked: [],
    detailOpen: false,
    dialog: null,
    barcodes: null,
    nextRun: 1,
    runs: {},
  };
  if (!consoleConnection(ctx.values)) return [model, []];
  return [
    model,
    [
      send<AppMsg>(
        { type: "app/load", resource: "console" },
        { type: "app/load", resource: "check" },
      ),
    ],
  ];
}

/** The spools the list shows: matching the filter, in the chosen order. */
export function visibleRows(model: SpoolsModel, ctx: Ctx): InventoryRow[] {
  const data = consoleValue(ctx.resources.console);
  if (!data) return [];
  return inventoryRows(data.spools, data.filaments, model.filter.value, model.sort);
}

/** The highlighted row: the cursor's spool when it's listed, else the row at its old place. */
export function cursorIndex(model: SpoolsModel, rows: InventoryRow[]): number {
  const found = model.cursorId ? rows.findIndex((r) => r.spool.id === model.cursorId) : -1;
  if (found >= 0) return found;
  return Math.max(0, Math.min(rows.length - 1, model.cursor));
}

function listRows(ctx: Ctx): number {
  return Math.max(1, ctx.bodyRows - LIST_CHROME - (stacksDetail(ctx) ? COMPACT_DETAIL : 0));
}

/** The model with its cursor on rows[index] (or where the cursor's spool now is). */
function settle(model: SpoolsModel, rows: InventoryRow[], index = cursorIndex(model, rows)) {
  return { ...model, cursor: index, cursorId: rows[index]?.spool.id ?? null };
}

function copyable(ctx: Ctx): CopyableFilament[] {
  const data = consoleValue(ctx.resources.console);
  return data ? copyableFilaments(data.spools, data.filaments) : [];
}

const toast = (text: string, tone: "ok" | "warning" | "failed"): AppMsg => ({
  type: "app/toast",
  text,
  tone,
});

const reloadMsgs: AppMsg[] = [
  { type: "app/load", resource: "console", force: true },
  { type: "app/load", resource: "check", force: true },
];

function freshScan(error = ""): ScanDialog {
  return { kind: "scan", text: textState(""), error, pending: null };
}

function countDialog(
  model: SpoolsModel,
  filament: CopyableFilament,
  back: ScanDialog | null,
  ctx: Ctx,
): CountDialog {
  const conn = consoleConnection(ctx.values);
  return {
    kind: "count",
    filament,
    count: 1,
    phase: "choose",
    results: [],
    error: "",
    run: model.nextRun,
    back,
    url: conn ? consoleUrl(conn) : "",
  };
}

function openScan(model: SpoolsModel, ctx: Ctx): Step<SpoolsModel> {
  if (copyable(ctx).length === 0)
    return [model, [send(toast("No spool on the console has a filament code to copy", "warning"))]];
  return [{ ...model, dialog: freshScan() }, [loadBarcodesCmd()]];
}

function openMore(model: SpoolsModel, ctx: Ctx): Step<SpoolsModel> {
  const rows = visibleRows(model, ctx);
  const row = rows[cursorIndex(model, rows)];
  if (!row) return [model, []];
  const filament = copyable(ctx).find((f) => f.code === row.spool.slicerFilament);
  if (!row.spool.slicerFilament || !filament)
    return [
      model,
      [
        send(
          toast(
            `Spool #${row.spool.id} has no filament code, so a copy couldn't be linked to a preset`,
            "warning",
          ),
        ),
      ],
    ];
  return [{ ...model, dialog: countDialog(model, filament, null, ctx) }, []];
}

/** The ticked spools in list order, else the highlighted one. */
function labelIds(model: SpoolsModel, ctx: Ctx): string[] {
  const rows = visibleRows(model, ctx);
  if (model.ticked.length > 0) {
    const data = consoleValue(ctx.resources.console);
    const all = data ? inventoryRows(data.spools, data.filaments, "", model.sort) : rows;
    return all.map((r) => r.spool.id).filter((id) => model.ticked.includes(id));
  }
  const row = rows[cursorIndex(model, rows)];
  return row ? [row.spool.id] : [];
}

function openLabels(model: SpoolsModel, ctx: Ctx): Step<SpoolsModel> {
  const spoolIds = labelIds(model, ctx);
  if (spoolIds.length === 0) return [model, []];
  return [model, [send<AppMsg>({ type: "app/openLabels", request: { spoolIds, fresh: false } })]];
}

function nextSort(sort: InventorySort): InventorySort {
  return INVENTORY_SORTS[(INVENTORY_SORTS.indexOf(sort) + 1) % INVENTORY_SORTS.length] ?? sort;
}

/** A palette command can come from another tab: a dialog it opens needs this tab in front. */
function shown([model, cmds]: Step<SpoolsModel>): Step<SpoolsModel> {
  return model.dialog
    ? [model, [send<AppMsg>({ type: "app/switchTab", tab: "spools" }), ...cmds]]
    : [model, cmds];
}

function act(model: SpoolsModel, action: SpoolsAction, ctx: Ctx): Step<SpoolsModel> {
  const screen = spoolsScreen(ctx);
  if (screen.kind === "unset") return [model, []];
  if (action === "reload") return [model, [send(...reloadMsgs)]];
  if (screen.kind !== "list") return [model, []];
  switch (action) {
    case "scan":
      return shown(openScan(model, ctx));
    case "labels":
      return openLabels(model, ctx);
    case "more":
      return shown(openMore(model, ctx));
    case "sort": {
      const sorted = { ...model, sort: nextSort(model.sort) };
      return [settle(sorted, visibleRows(sorted, ctx)), []];
    }
  }
}

function listKey(model: SpoolsModel, key: KeyPress, ctx: Ctx): Step<SpoolsModel> {
  const rows = visibleRows(model, ctx);
  const index = cursorIndex(model, rows);
  const moved = moveCursor(index, key, rows.length, listRows(ctx));
  if (moved !== null) return [settle(model, rows, moved), []];
  if (key.name === "space") {
    const id = rows[index]?.spool.id;
    if (!id) return [model, []];
    const ticked = model.ticked.includes(id)
      ? model.ticked.filter((t) => t !== id)
      : [...model.ticked, id];
    return [settle({ ...model, ticked }, rows, Math.min(rows.length - 1, index + 1)), []];
  }
  if (key.name === "enter")
    return isWide(ctx) ? [model, []] : [{ ...model, detailOpen: !model.detailOpen }, []];
  if (key.name === "esc") {
    if (model.filter.value) {
      const cleared = { ...model, filter: textState("") };
      return [settle(cleared, visibleRows(cleared, ctx)), []];
    }
    if (model.detailOpen) return [{ ...model, detailOpen: false }, []];
    return [{ ...model, ticked: [] }, []];
  }
  switch (letter(key)) {
    case "/":
      return [{ ...model, filtering: true }, []];
    case "s": {
      const sorted = { ...model, sort: nextSort(model.sort) };
      return [settle(sorted, visibleRows(sorted, ctx)), []];
    }
    case "l":
      return openLabels(model, ctx);
    case "+":
      return openMore(model, ctx);
    case "b":
      return openScan(model, ctx);
    case "c":
      return syncProblems(ctx) > 0
        ? [model, [send<AppMsg>({ type: "app/switchTab", tab: "check" })]]
        : [model, []];
    case "r":
      return [model, [send(...reloadMsgs)]];
    default:
      return [model, []];
  }
}

/** Problems the sync check found; 0 until it has run. */
function syncProblems(ctx: Ctx): number {
  const check = ctx.resources.check;
  return check.state === "ready" ? checkCounts(check.value.sections).problems : 0;
}

/** Opens on the spool a deep link names, clearing a filter that hides it; unknown IDs change nothing. */
function focusSpool(model: SpoolsModel, id: string, ctx: Ctx): Step<SpoolsModel> {
  const data = consoleValue(ctx.resources.console);
  if (!data?.spools.some((s) => s.id === id)) return [model, []];
  const shownNow = visibleRows(model, ctx).some((r) => r.spool.id === id);
  const next = shownNow ? model : { ...model, filter: textState(""), filtering: false };
  const rows = visibleRows(next, ctx);
  return [
    settle(
      next,
      rows,
      rows.findIndex((r) => r.spool.id === id),
    ),
    [],
  ];
}

const LIST_MOVES = new Set(["up", "down", "pageUp", "pageDown"]);

function filterKey(model: SpoolsModel, key: KeyPress, ctx: Ctx): Step<SpoolsModel> {
  if (key.name === "esc") {
    const cleared = { ...model, filter: textState(""), filtering: false };
    return [settle(cleared, visibleRows(cleared, ctx)), []];
  }
  if (key.name === "enter") return [{ ...model, filtering: false }, []];
  if (key.name && LIST_MOVES.has(key.name)) return listKey(model, key, ctx);
  const edit = editText(model.filter, key);
  if (!edit) return [model, []];
  // A paste ending in a line break keeps the filter, as enter does.
  const next = {
    ...model,
    filter: { value: edit.value, cursor: edit.cursor },
    filtering: !edit.submit,
  };
  return [settle(next, visibleRows(next, ctx)), []];
}

/** The Settings row that would make the console readable: the first one missing, else its address. */
export function settingsFocus(ctx: Ctx): string {
  const { values } = ctx;
  if (values.skipSpoolease) return "spoolease.skip";
  if (!values.host.trim()) return "spoolease.host";
  if (!values.securityKey) return "spoolease.key";
  return "spoolease.host";
}

function emptyKey(
  model: SpoolsModel,
  screen: SpoolsScreen,
  key: KeyPress,
  ctx: Ctx,
): Step<SpoolsModel> {
  if ((screen.kind === "unset" || screen.kind === "failed") && key.name === "enter")
    return [
      model,
      [send<AppMsg>({ type: "app/switchTab", tab: "settings", focus: settingsFocus(ctx) })],
    ];
  if (screen.kind === "unset") return [model, []];
  if (screen.kind === "empty" && key.name === "enter")
    return [model, [send<AppMsg>({ type: "app/switchTab", tab: "add" })]];
  if (letter(key) === "r") return [model, [send(...reloadMsgs)]];
  return [model, []];
}

function withDialog(model: SpoolsModel, dialog: Dialog | null): Step<SpoolsModel> {
  return [{ ...model, dialog }, []];
}

/** A known barcode goes to its filament; a new one, or one whose filament has no spool now, asks which it is. */
function lookUp(model: SpoolsModel, barcode: string, ctx: Ctx): Step<SpoolsModel> {
  const filaments = copyable(ctx);
  const known = model.barcodes?.get(barcode);
  const filament = known ? filaments.find((f) => f.code === known.code) : undefined;
  if (filament) return withDialog(model, { kind: "known", barcode, filament, cursor: 0 });
  return withDialog(model, {
    kind: "choose",
    barcode,
    gone: known ?? null,
    filaments,
    cursor: 0,
    saving: false,
  });
}

function submitScan(
  model: SpoolsModel,
  dialog: ScanDialog,
  text: string,
  ctx: Ctx,
): Step<SpoolsModel> {
  const barcode = normalizeBarcode(text);
  if (!barcode) return withDialog(model, { ...dialog, text: textState(text.trim()) });
  if (!model.barcodes) return withDialog(model, { ...dialog, pending: barcode });
  return lookUp(model, barcode, ctx);
}

function scanKey(
  model: SpoolsModel,
  dialog: ScanDialog,
  key: KeyPress,
  ctx: Ctx,
): Step<SpoolsModel> {
  if (key.name === "esc") return withDialog(model, null);
  if (key.name === "enter") return submitScan(model, dialog, dialog.text.value, ctx);
  // A scanner types its code and enter so fast that they arrive as one input.
  const burst = typed(key);
  const end = burst.search(/[\r\n]/);
  if (end >= 0) return submitScan(model, dialog, dialog.text.value + burst.slice(0, end), ctx);
  const edit = editText(dialog.text, key);
  if (!edit) return [model, []];
  return withDialog(model, {
    ...dialog,
    text: { value: edit.value, cursor: edit.cursor },
    error: "",
  });
}

function knownKey(
  model: SpoolsModel,
  dialog: KnownDialog,
  key: KeyPress,
  ctx: Ctx,
): Step<SpoolsModel> {
  if (key.name === "esc") return withDialog(model, freshScan());
  const moved = moveCursor(dialog.cursor, key, 2, 2);
  if (moved !== null) return withDialog(model, { ...dialog, cursor: moved });
  if (key.name !== "enter") return [model, []];
  if (dialog.cursor === 0)
    return withDialog(model, countDialog(model, dialog.filament, freshScan(), ctx));
  return withDialog(model, {
    kind: "choose",
    barcode: dialog.barcode,
    gone: null,
    filaments: copyable(ctx),
    cursor: 0,
    saving: false,
  });
}

function chooseKey(model: SpoolsModel, dialog: ChooseDialog, key: KeyPress): Step<SpoolsModel> {
  if (key.name === "esc") return withDialog(model, freshScan());
  if (dialog.saving) return [model, []];
  // The filaments, then Other… for one the console has no spool of yet.
  const count = dialog.filaments.length + 1;
  const moved = moveCursor(dialog.cursor, key, count, 8);
  if (moved !== null) return withDialog(model, { ...dialog, cursor: moved });
  if (key.name === "enter") {
    const filament = dialog.filaments[dialog.cursor];
    if (!filament)
      return [
        { ...model, dialog: null },
        [
          send<AppMsg>(
            { type: "app/switchTab", tab: "add" },
            toast(`Add the filament, then scan ${dialog.barcode} again`, "ok"),
          ),
        ],
      ];
    return [
      { ...model, dialog: { ...dialog, saving: true } },
      [rememberBarcodeCmd(dialog.barcode, { code: filament.code, name: filament.name })],
    ];
  }
  const char = letter(key);
  if (!char) return [model, []];
  const names = dialog.filaments.map((f) => f.name);
  return withDialog(model, { ...dialog, cursor: typeAhead(names, dialog.cursor, char) });
}

function countKey(
  model: SpoolsModel,
  dialog: CountDialog,
  key: KeyPress,
  ctx: Ctx,
): Step<SpoolsModel> {
  const back = dialog.back ? freshScan() : null;
  if (dialog.phase === "running") return key.name === "esc" ? withDialog(model, back) : [model, []];
  if (dialog.phase === "done") {
    if (key.name === "esc" || key.name === "enter") return withDialog(model, back);
    const created = dialog.results.flatMap((r) => (r.ok && r.id ? [r.id] : []));
    if (letter(key) === "l" && created.length > 0)
      return [
        { ...model, dialog: null },
        [send<AppMsg>({ type: "app/openLabels", request: { spoolIds: created, fresh: true } })],
      ];
    return [model, []];
  }
  if (key.name === "esc") return withDialog(model, back);
  const setCount = (count: number) =>
    withDialog(model, { ...dialog, count: Math.max(1, Math.min(MAX_COPIES, count)) });
  if (key.name === "up" || key.name === "right") return setCount(dialog.count + 1);
  if (key.name === "down" || key.name === "left") return setCount(dialog.count - 1);
  if (key.name === "home") return setCount(1);
  if (key.name === "end") return setCount(MAX_COPIES);
  const char = letter(key);
  const digit = Number(char);
  if (char >= "1" && char <= "9" && digit <= MAX_COPIES) return setCount(digit);
  if (char !== "a" && key.name !== "enter") return [model, []];
  const conn = consoleConnection(ctx.values);
  if (!conn) return [model, []];
  const run = model.nextRun;
  return [
    {
      ...model,
      nextRun: run + 1,
      runs: {
        ...model.runs,
        [run]: { name: dialog.filament.name, count: dialog.count, url: consoleUrl(conn) },
      },
      dialog: { ...dialog, phase: "running", results: [], run },
    },
    [addCopiesCmd(conn, dialog.filament, dialog.count, run)],
  ];
}

function dialogKey(model: SpoolsModel, dialog: Dialog, key: KeyPress, ctx: Ctx): Step<SpoolsModel> {
  switch (dialog.kind) {
    case "scan":
      return scanKey(model, dialog, key, ctx);
    case "known":
      return knownKey(model, dialog, key, ctx);
    case "choose":
      return chooseKey(model, dialog, key);
    case "count":
      return countKey(model, dialog, key, ctx);
  }
}

function onKey(model: SpoolsModel, key: KeyPress, ctx: Ctx): Step<SpoolsModel> {
  if (model.dialog) return dialogKey(model, model.dialog, key, ctx);
  const screen = spoolsScreen(ctx);
  if (screen.kind !== "list") return emptyKey(model, screen, key, ctx);
  return model.filtering ? filterKey(model, key, ctx) : listKey(model, key, ctx);
}

/**
 * What a finished copy run tells the session: summary lines, the console to reload, and a toast when
 * its dialog was closed (an open one shows the outcome itself).
 */
function copiesFinished(
  info: RunInfo,
  results: SpoolEaseWrite[],
  error: string,
  exitCode: 1 | 2 | undefined,
  shown: boolean,
): Cmd<AppMsg> {
  const created = results.flatMap((r) => (r.ok ? [r.id] : []));
  const failed = results.length - created.length;
  const ok = !error && failed === 0;
  const lines = error
    ? [`No spools of ${info.name} added: ${error}`]
    : [
        created.length > 0
          ? `${plural(created.length, "spool")} of ${info.name} added to ${info.url}: ${created
              .filter(Boolean)
              .map((id) => `#${id}`)
              .join(", ")}`
          : `No spools of ${info.name} added to ${info.url}`,
        ...results.flatMap((r, i) =>
          r.ok ? [] : [`spool ${i + 1} of ${results.length}: ${r.error}`],
        ),
      ];
  const summary = ok ? { ok, lines } : { ok, lines, exitCode: exitCode ?? 1 };
  const note = error
    ? toast(`No spools added: ${error}`, "failed")
    : failed > 0
      ? toast(`${failed} of ${plural(results.length, "spool")} of ${info.name} failed`, "failed")
      : toast(`${plural(created.length, "spool")} of ${info.name} added`, "ok");
  return send<AppMsg>(
    { type: "app/runFinished", summary },
    ...(shown ? [] : [note]),
    ...reloadMsgs,
  );
}

function onMsg(model: SpoolsModel, msg: SpoolsMsg, ctx: Ctx): Step<SpoolsModel> {
  const dialog = model.dialog;
  switch (msg.type) {
    case "spools/barcodes": {
      const next = { ...model, barcodes: msg.barcodes };
      if (dialog?.kind === "scan" && dialog.pending)
        return lookUp({ ...next, dialog: { ...dialog, pending: null } }, dialog.pending, ctx);
      return [next, []];
    }
    case "spools/remembered": {
      const barcodes = new Map(model.barcodes ?? []);
      barcodes.set(msg.barcode, msg.filament);
      const next = { ...model, barcodes };
      if (dialog?.kind !== "choose" || dialog.barcode !== msg.barcode) return [next, []];
      const filament = dialog.filaments.find((f) => f.code === msg.filament.code);
      if (!filament) return withDialog(next, freshScan());
      return withDialog(next, countDialog(next, filament, freshScan(), ctx));
    }
    case "spools/rememberFailed":
      if (dialog?.kind !== "choose" || dialog.barcode !== msg.barcode) return [model, []];
      return withDialog(model, freshScan(`Couldn't remember barcode ${msg.barcode}: ${msg.error}`));
    case "spools/copy":
      if (dialog?.kind !== "count" || dialog.run !== msg.run || dialog.phase !== "running")
        return [model, []];
      return withDialog(model, { ...dialog, results: [...dialog.results, msg.result] });
    case "spools/copiesDone": {
      const { [msg.run]: info, ...runs } = model.runs;
      const shown = dialog?.kind === "count" && dialog.run === msg.run;
      const next: SpoolsModel = {
        ...model,
        runs,
        dialog: shown
          ? { ...dialog, phase: "done", results: msg.results, error: msg.error }
          : dialog,
      };
      const known = info ?? { name: "the filament", count: msg.results.length, url: "" };
      return [next, [copiesFinished(known, msg.results, msg.error, msg.exitCode, shown)]];
    }
    case "spools/command":
      return act(model, msg.action, ctx);
  }
}

export function update(model: SpoolsModel, msg: AppMsg | TabMsg, ctx: Ctx): Step<SpoolsModel> {
  const m = msg as AppMsg | SpoolsMsg;
  switch (m.type) {
    case "key":
      return onKey(model, m.key, ctx);
    case "paste":
      // The shell only sends a paste while capturesText: it's typed text, a scanner's burst included.
      return capturesText(model) ? onKey(model, pasted(m.text), ctx) : [model, []];
    case "app/switchTab":
      return m.focus && !model.dialog ? focusSpool(model, m.focus, ctx) : [model, []];
    case "app/loaded": {
      if (m.resource !== "console") return [model, []];
      const loaded: Ctx = {
        ...ctx,
        resources: { ...ctx.resources, console: m.result as Resource<ConsoleData> },
      };
      const data = consoleValue(loaded.resources.console);
      const ids = new Set(data?.spools.map((s) => s.id) ?? []);
      const ticked = data ? model.ticked.filter((id) => ids.has(id)) : model.ticked;
      return [settle({ ...model, ticked }, visibleRows(model, loaded)), []];
    }
    default:
      if (m.type.startsWith("spools/")) return onMsg(model, m as SpoolsMsg, ctx);
      return [model, []];
  }
}

export function capturesText(model: SpoolsModel): boolean {
  return model.filtering || model.dialog?.kind === "scan";
}

/** A dialog of the tab's own is open: its keys are what work, q and tab included. */
export function modal(model: SpoolsModel): boolean {
  return model.dialog !== null;
}

/** What's being written: copies still being added (their dialog may be hidden), or a barcode being saved. */
export function busy(model: SpoolsModel): string | null {
  const run = Object.values(model.runs)[0];
  if (run) return `Adding ${plural(run.count, "spool")} of ${run.name} to SpoolEase`;
  if (model.dialog?.kind === "choose" && model.dialog.saving)
    return `Remembering barcode ${model.dialog.barcode}`;
  return null;
}

function highlightedRow(model: SpoolsModel, ctx: Ctx): InventoryRow | undefined {
  const rows = visibleRows(model, ctx);
  return rows[cursorIndex(model, rows)];
}

export function dialogHints(dialog: Dialog): Hint[] {
  switch (dialog.kind) {
    case "scan":
      return [
        { keys: "type", label: "the barcode, or scan it", primary: true },
        { keys: "enter", label: "look up", primary: true },
        { keys: "esc", label: "close", primary: true },
      ];
    case "known":
      return [
        { keys: "↑↓", label: "move", primary: true },
        { keys: "enter", label: "choose", primary: true },
        { keys: "esc", label: "scan again", primary: true },
      ];
    case "choose":
      return [
        { keys: "↑↓", label: "move", primary: true },
        { keys: "a-z", label: "jump" },
        { keys: "enter", label: "this filament", primary: true },
        { keys: "esc", label: "scan again", primary: true },
      ];
    case "count": {
      const back = dialog.back ? "scan again" : "back";
      if (dialog.phase === "running") return [{ keys: "esc", label: "hide", primary: true }];
      if (dialog.phase === "done") {
        const created = dialog.results.filter((r) => r.ok).length;
        // esc does what enter does here, so only enter is named.
        return [
          ...(created > 0
            ? [{ keys: "l", label: `labels for ${plural(created, "new spool")}`, primary: true }]
            : []),
          { keys: "enter", label: dialog.back ? "scan another" : "done", primary: true },
        ];
      }
      return [
        { keys: "↑↓", label: "how many", primary: true },
        { keys: "1-8", label: "set" },
        { keys: "enter", label: `add ${plural(dialog.count, "spool")}`, primary: true },
        { keys: "esc", label: back, primary: true },
      ];
    }
  }
}

export function hints(model: SpoolsModel, ctx: Ctx): Hint[] {
  if (model.dialog) return dialogHints(model.dialog);
  const screen = spoolsScreen(ctx);
  switch (screen.kind) {
    case "unset":
      return [{ keys: "enter", label: "open Settings", primary: true }];
    case "loading":
      return [];
    case "failed":
      return [
        { keys: "r", label: "try again", primary: true },
        { keys: "enter", label: "open Settings", primary: true },
      ];
    case "empty":
      return [
        { keys: "enter", label: "add spools", primary: true },
        { keys: "r", label: "reload", primary: true },
      ];
    case "list":
      break;
  }
  if (model.filtering)
    return [
      { keys: "type", label: "filter", primary: true },
      { keys: "↑↓", label: "move", primary: true },
      { keys: "enter", label: "keep filter", primary: true },
      { keys: "esc", label: "clear", primary: true },
    ];
  const row = highlightedRow(model, ctx);
  const ticked = model.ticked.length;
  const problems = syncProblems(ctx);
  return [
    { keys: "↑↓", label: "move", primary: true },
    ...(isWide(ctx)
      ? []
      : [
          model.detailOpen
            ? { keys: "enter", label: "back to the list", primary: true }
            : { keys: "enter", label: "details", primary: true },
        ]),
    { keys: "space", label: "tick" },
    { keys: "/", label: "filter", primary: true },
    { keys: "s", label: "sort", primary: true },
    { keys: "l", label: ticked > 0 ? `labels for ${ticked}` : "label", primary: true },
    ...(row?.spool.slicerFilament ? [{ keys: "+", label: "more like this", primary: true }] : []),
    { keys: "b", label: "scan", primary: true },
    ...(problems > 0 ? [{ keys: "c", label: `see ${plural(problems, "problem")}` }] : []),
    { keys: "r", label: "reload" },
    ...(model.filter.value ? [{ keys: "esc", label: "clear filter", primary: true }] : []),
  ];
}

export function commands(model: SpoolsModel, ctx: Ctx): PaletteCommand[] {
  if (!consoleConnection(ctx.values)) return [];
  const command = (title: string, action: SpoolsAction, keys: string): PaletteCommand => ({
    title,
    detail: "Spools",
    keys,
    msg: toTab("spools", { type: "spools/command", action }),
  });
  const row = highlightedRow(model, ctx);
  const ticked = model.ticked.length;
  const problems = syncProblems(ctx);
  return [
    command("Scan a barcode", "scan", "b"),
    ...(row
      ? [
          command(
            ticked > 0
              ? `Labels for ${plural(ticked, "ticked spool")}`
              : "Labels for the highlighted spool",
            "labels",
            "l",
          ),
        ]
      : []),
    ...(row?.spool.slicerFilament ? [command("More spools like this one", "more", "+")] : []),
    command("Sort spools", "sort", "s"),
    ...(problems > 0
      ? [
          {
            title: `Open Check: ${plural(problems, "sync problem")}`,
            detail: "Spools",
            keys: "c",
            msg: { type: "app/switchTab", tab: "check" } as AppMsg,
          },
        ]
      : []),
  ];
}
