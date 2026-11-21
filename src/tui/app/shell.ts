// ABOUTME: The shell's model and pure update: tabs, overlays, background resources, toast, error banner, session runs, quitting.
// ABOUTME: createShell(deps) takes the tabs, loaders and clock, so tests drive it with fakes; Shell.tsx only feeds it input.

import { errorMessage } from "../../errors.js";
import { checkCounts } from "../../syncCheck.js";
import { isCtrl, type KeyPress, press } from "../core/keys.js";
import { type Cmd, send } from "../core/program.js";
import {
  type AppMsg,
  type CheckData,
  type Ctx,
  type Hint,
  type OverlayId,
  type Resource,
  type ResourceId,
  type Resources,
  type RunSummary,
  type StartOptions,
  TAB_ORDER,
  type TabId,
  type TabMsg,
} from "../core/types.js";
import type { FormValues } from "../core/values.js";
import { plural } from "../ui/format.js";
import { frameBody, type HeaderTab } from "../ui/index.js";
import { CONFIRM, type ShellConfirmRequest } from "./confirm.js";
import { HELP, type HelpRequest } from "./help.js";
import type { PaletteItem, ShellMsg, ShellOverlay } from "./messages.js";
import { PALETTE, SHELL_GROUPS } from "./palette.js";
import type { AnyLabels, AnyTab } from "./registry.js";
import { affectedResources, consoleConfigured, type Loaders, reloading } from "./resources.js";

export type { ShellMsg } from "./messages.js";

export interface ShellDeps {
  tabs: Record<TabId, AnyTab>;
  labels: AnyLabels;
  loaders: Loaders;
  now: () => number;
  /** How long a toast stays. */
  toastMs: number;
}

export interface Toast {
  id: number;
  text: string;
  tone?: "ok" | "warning" | "failed";
}

export interface OpenOverlay {
  id: OverlayId;
  model: unknown;
}

export interface ShellModel {
  values: FormValues;
  start: StartOptions;
  columns: number;
  rows: number;
  active: TabId;
  /** Every tab's model, kept while another tab is shown. */
  tabs: Record<TabId, unknown>;
  resources: Resources;
  /** Bumped by every load, so a slower, older load can't overwrite a newer one. */
  gens: Record<ResourceId, number>;
  /** Resources something asked for: only these reload when settings change. */
  requested: ResourceId[];
  overlay: OpenOverlay | null;
  toast: Toast | null;
  toastSeq: number;
  summaries: RunSummary[];
  error: string | null;
  /** Set when the session ends: the exit code. */
  exit: number | null;
}

type Step = [ShellModel, Cmd<ShellMsg>[]];

/** Spools when there's a console to show and nothing to search for; else Add. */
export function landingTab(values: FormValues, start: StartOptions): TabId {
  const adding = start.query.trim() !== "" || values.source.trim() !== "";
  return consoleConfigured(values) && !adding ? "spools" : "add";
}

/** The highest code any run of the session asks for: 2 for setup errors, 1 for failures, else 0. */
export function exitCode(summaries: RunSummary[]): number {
  return Math.max(0, ...summaries.map((s) => s.exitCode ?? (s.ok ? 0 : 1)));
}

/** What the session's runs said, for the normal screen once the alternate screen is gone; "" without runs. */
export function summaryText(summaries: RunSummary[]): string {
  return summaries.map((s) => `${s.lines.join("\n")}\n`).join("\n");
}

/** In the order they give way when the footer is narrow (Footer drops from the left, never ? help). */
const GLOBAL_HINTS: Hint[] = [
  { keys: "ctrl+k", label: "commands" },
  { keys: "tab", label: "next tab" },
  { keys: "?", label: "help", primary: true },
  { keys: "q", label: "quit" },
];

/** Keys a text field moves or deletes by word with meta: kept whole while text is being typed. */
const WORD_KEYS = new Set(["left", "right", "backspace"]);

const RESOURCE_TITLES: Record<ResourceId, string> = {
  console: "Reload spools from the console",
  presets: "Reload BambuStudio presets",
  catalog: "Reload the SpoolmanDB catalog",
  check: "Check sync again",
};

// The shell's own overlays and the labels overlay share one shape for routing.
type AnyOverlay = ShellOverlay<unknown, unknown>;

export function createShell(deps: ShellDeps) {
  const overlays: Record<OverlayId, AnyOverlay> = {
    help: HELP as AnyOverlay,
    palette: PALETTE as AnyOverlay,
    confirm: CONFIRM as AnyOverlay,
    labels: deps.labels as AnyOverlay,
  };

  function ctx(model: ShellModel): Ctx {
    const body = frameBody(model.columns, model.rows);
    return {
      values: model.values,
      resources: model.resources,
      columns: model.columns,
      rows: model.rows,
      bodyColumns: body.columns,
      // The error banner takes the body's first line.
      bodyRows: Math.max(1, body.rows - (model.error ? 1 : 0)),
      now: deps.now(),
      activeTab: model.active,
    };
  }

  const tab = (model: ShellModel, id: TabId = model.active) => deps.tabs[id];

  function capturing(model: ShellModel): boolean {
    return tab(model).capturesText(model.tabs[model.active]);
  }

  /** One tab's update, its new model kept. */
  function toTab(model: ShellModel, id: TabId, msg: AppMsg | TabMsg): Step {
    const [next, cmds] = tab(model, id).update(model.tabs[id], msg, ctx(model));
    return [{ ...model, tabs: { ...model.tabs, [id]: next } }, cmds];
  }

  /** Every tab's update (and the overlay's), in order. */
  function toAll(model: ShellModel, msg: AppMsg): Step {
    let current = model;
    const cmds: Cmd<ShellMsg>[] = [];
    for (const id of TAB_ORDER) {
      const [next, more] = toTab(current, id, msg);
      current = next;
      cmds.push(...more);
    }
    if (current.overlay) {
      const [next, more] = toOverlay(current, msg);
      current = next;
      cmds.push(...more);
    }
    return [current, cmds];
  }

  function toOverlay(model: ShellModel, msg: AppMsg | TabMsg): Step {
    if (!model.overlay) return [model, []];
    const module = overlays[model.overlay.id];
    const [next, cmds] = module.update(model.overlay.model, msg, ctx(model));
    return [{ ...model, overlay: { id: model.overlay.id, model: next } }, cmds];
  }

  function open(model: ShellModel, id: OverlayId, request: unknown): Step {
    const [overlayModel, cmds] = overlays[id].init(request, ctx(model));
    return [{ ...model, overlay: { id, model: overlayModel } }, cmds];
  }

  function helpRequest(model: ShellModel): HelpRequest {
    const active = tab(model);
    return {
      tab: model.active,
      title: active.title,
      hints: active.hints(model.tabs[model.active], ctx(model)),
      typing: capturing(model),
    };
  }

  function paletteItems(model: ShellModel): PaletteItem[] {
    const c = ctx(model);
    const tabCommands = (id: TabId): PaletteItem[] =>
      (tab(model, id).commands?.(model.tabs[id], c) ?? []).map((command) => ({
        title: command.title,
        detail: command.detail ?? tab(model, id).title,
        ...(command.keys ? { keys: command.keys } : {}),
        msg: command.msg,
        tab: id,
      }));
    return [
      ...tabCommands(model.active),
      ...TAB_ORDER.map(
        (id): PaletteItem => ({
          title: `Go to ${tab(model, id).title}`,
          detail: SHELL_GROUPS.tab,
          msg: { type: "app/switchTab", tab: id },
        }),
      ),
      ...TAB_ORDER.filter((id) => id !== model.active).flatMap(tabCommands),
      ...(["console", "presets", "catalog", "check"] as const)
        .filter((id) => id === "presets" || id === "catalog" || consoleConfigured(model.values))
        .map(
          (id): PaletteItem => ({
            title: RESOURCE_TITLES[id],
            detail: SHELL_GROUPS.data,
            msg: { type: "app/load", resource: id, force: true },
          }),
        ),
      { title: "Help", detail: SHELL_GROUPS.app, keys: "?", msg: { type: "shell/help" } },
      { title: "Quit", detail: SHELL_GROUPS.app, keys: "q", msg: { type: "app/quit" } },
    ];
  }

  /** Whether a load could apply at all with these settings: the console's need one set up. */
  function applies(id: ResourceId, values: FormValues): boolean {
    return id === "console" || id === "check" ? consoleConfigured(values) : true;
  }

  function setResource(model: ShellModel, id: ResourceId, result: Resource<unknown>): ShellModel {
    return { ...model, resources: { ...model.resources, [id]: result } };
  }

  /** Starts loading a resource (or marks it idle when it can't apply), keeping its last value on screen. */
  function load(model: ShellModel, id: ResourceId): Step {
    const gen = model.gens[id] + 1;
    const requested = model.requested.includes(id) ? model.requested : [...model.requested, id];
    const base = { ...model, gens: { ...model.gens, [id]: gen }, requested };
    if (!applies(id, model.values)) {
      const idle: Resource<unknown> = { state: "idle" };
      return toAll(setResource(base, id, idle), { type: "app/loaded", resource: id, result: idle });
    }
    const values = model.values;
    const cmd: Cmd<ShellMsg> = async (dispatch) => {
      const loader = deps.loaders[id] as (values: FormValues) => Promise<unknown> | null;
      let result: Resource<unknown>;
      try {
        const pending = loader(values);
        result = pending
          ? { state: "ready", value: await pending, at: deps.now() }
          : { state: "idle" };
      } catch (err) {
        // The shell fills in the previous value when the result arrives.
        result = { state: "failed", error: errorMessage(err) };
      }
      dispatch({ type: "shell/loaded", resource: id, gen, result });
    };
    return [setResource(base, id, reloading(model.resources[id] as Resource<unknown>)), [cmd]];
  }

  function loadAll(model: ShellModel, ids: ResourceId[]): Step {
    let current = model;
    const cmds: Cmd<ShellMsg>[] = [];
    for (const id of ids) {
      const [next, more] = load(current, id);
      current = next;
      cmds.push(...more);
    }
    return [current, cmds];
  }

  function loaded(model: ShellModel, id: ResourceId, result: Resource<unknown>): Step {
    const current = model.resources[id];
    const previous = current.state === "loading" ? current.previous : undefined;
    const kept =
      result.state === "failed" && result.previous === undefined && previous !== undefined
        ? { ...result, previous }
        : result;
    return toAll(setResource(model, id, kept), { type: "app/loaded", resource: id, result: kept });
  }

  /**
   * Makes a tab the active one and tells it, so it can load what it needs on its first visit; focus,
   * from a deep link, is what it should open on.
   */
  function show(model: ShellModel, tab: TabId, focus?: string): Step {
    return toTab({ ...model, active: tab }, tab, {
      type: "app/switchTab",
      tab,
      ...(focus === undefined ? {} : { focus }),
    });
  }

  /** A toast that clears itself after toastMs. */
  function withToast(model: ShellModel, text: string, tone?: Toast["tone"]): Step {
    const id = model.toastSeq + 1;
    const expire: Cmd<ShellMsg> = (dispatch) =>
      new Promise<void>((resolve) => {
        // unref: a toast never keeps the process alive after the app exits.
        setTimeout(() => {
          dispatch({ type: "shell/toastExpired", id });
          resolve();
        }, deps.toastMs).unref?.();
      });
    return [{ ...model, toastSeq: id, toast: { id, text, ...(tone ? { tone } : {}) } }, [expire]];
  }

  /** What the overlay or any tab, shown or not, is writing right now, else null. */
  function busyWith(model: ShellModel): string | null {
    if (model.overlay) {
      const what = overlays[model.overlay.id].busy?.(model.overlay.model);
      if (what) return what;
    }
    for (const id of TAB_ORDER) {
      const what = deps.tabs[id].busy?.(model.tabs[id]);
      if (what) return what;
    }
    return null;
  }

  /** Each tab with changes quitting would drop, and how many, in tab order. */
  function unsavedWork(model: ShellModel): { title: string; count: number }[] {
    return TAB_ORDER.map((id) => ({
      title: deps.tabs[id].title,
      count: deps.tabs[id].unsaved?.(model.tabs[id]) ?? 0,
    })).filter((tab) => tab.count > 0);
  }

  /**
   * Quits with the session's exit code, unless a write is running (leaving would cut it short); with
   * unsaved changes anywhere, asks first. confirmed skips the asking.
   */
  function quit(model: ShellModel, confirmed = false): Step {
    const what = busyWith(model);
    if (what)
      return withToast(model, `${what}: wait for it to finish, or ctrl+c to stop now`, "warning");
    const unsaved = confirmed ? [] : unsavedWork(model);
    if (unsaved.length > 0) {
      const total = unsaved.reduce((sum, tab) => sum + tab.count, 0);
      const request: ShellConfirmRequest = {
        title: `Quit and drop ${plural(total, "unsaved change")}?`,
        lines: unsaved.map((tab) => `${tab.title}: ${plural(tab.count, "change")} not saved`),
        onApply: { type: "shell/quitNow" },
        applyKeys: ["q"],
        applyLabel: "quit",
        cancelLabel: "stay",
      };
      return open(model, "confirm", request);
    }
    return [{ ...model, exit: exitCode(model.summaries) }, []];
  }

  /** True while the active tab shows a dialog of its own: keys the shell would take go to it. */
  function modal(model: ShellModel): boolean {
    return tab(model).modal?.(model.tabs[model.active]) ?? false;
  }

  /** True while keys may be editing text: the tab takes text, or an overlay (which may have a field) is open. */
  function typing(model: ShellModel): boolean {
    return model.overlay !== null || capturing(model);
  }

  /**
   * The keys a key event stands for. Ink holds a lone ESC for 20 ms and reads it together with the
   * next key's bytes when they arrive in one chunk (a busy event loop), reporting meta+key: esc and
   * the key, unless it's a word move (meta ←→ backspace) in a text field. Nothing binds alt+key.
   */
  function unmerged(model: ShellModel, key: KeyPress): KeyPress[] {
    if (!key.meta || key.ctrl) return [key];
    if (typing(model) && WORD_KEYS.has(key.name ?? "")) return [key];
    return [press("esc"), { ...key, meta: false }];
  }

  /**
   * Letters typed quickly can reach Ink as one input ("sl": sort, then labels), which matches no key.
   * Outside a text field such a burst is one key per character; inside one it's typed as it came, and a
   * run ending in enter (a barcode scan) always stays whole. Null when the key isn't such a burst.
   */
  function lettersApart(model: ShellModel, key: KeyPress): KeyPress[] | null {
    if (key.name || key.ctrl || key.meta || typing(model)) return null;
    const chars = [...new Intl.Segmenter().segment(key.input)].map((part) => part.segment);
    if (chars.length < 2 || /[\r\n]$/.test(key.input)) return null;
    return chars.map((char) =>
      char === " " ? press("space") : { input: char, ctrl: false, shift: false, meta: false },
    );
  }

  function onKey(model: ShellModel, key: KeyPress): Step {
    const msg: AppMsg = { type: "key", key };
    if (model.overlay) return toOverlay(model, msg);
    // A tab's own dialog takes every key, as an overlay does (ctrl+c never reaches here).
    if (modal(model)) return toTab(model, model.active, msg);
    if (key.name === "tab" && !key.ctrl && !key.meta) {
      const at = TAB_ORDER.indexOf(model.active);
      const step = key.shift ? -1 : 1;
      const next = TAB_ORDER[(at + step + TAB_ORDER.length) % TAB_ORDER.length] as TabId;
      return show(model, next);
    }
    if (isCtrl(key, "k")) return open(model, "palette", paletteItems(model));
    if (!capturing(model) && !key.name && !key.ctrl && !key.meta) {
      if (key.input === "q") return quit(model);
      if (key.input === "?") return open(model, "help", helpRequest(model));
    }
    return toTab(model, model.active, msg);
  }

  function init(
    values: FormValues,
    start: StartOptions,
    size: { columns: number; rows: number },
  ): Step {
    const idle: Resource<unknown> = { state: "idle" };
    let model: ShellModel = {
      values,
      start,
      columns: size.columns,
      rows: size.rows,
      active: landingTab(values, start),
      tabs: {} as Record<TabId, unknown>,
      // The first two load as soon as the first frame is up (shell/mounted).
      resources: {
        console: consoleConfigured(values) ? { state: "loading" } : idle,
        presets: { state: "loading" },
        catalog: idle,
        check: idle,
      } as Resources,
      gens: { console: 0, presets: 0, catalog: 0, check: 0 },
      requested: [],
      overlay: null,
      toast: null,
      toastSeq: 0,
      summaries: [],
      error: null,
      exit: null,
    };
    const cmds: Cmd<ShellMsg>[] = [];
    for (const id of TAB_ORDER) {
      const [tabModel, more] = deps.tabs[id].init(ctx(model), start);
      model = { ...model, tabs: { ...model.tabs, [id]: tabModel } };
      cmds.push(...more);
    }
    return [model, cmds];
  }

  function update(model: ShellModel, msg: ShellMsg): Step {
    if (model.exit !== null) return [model, []];
    switch (msg.type) {
      case "key": {
        // Any key dismisses the error banner, and still does what it does.
        const current = model.error ? { ...model, error: null } : model;
        const [first, ...rest] = lettersApart(current, msg.key) ?? unmerged(current, msg.key);
        const [next, cmds] = onKey(current, first as KeyPress);
        // After the first key's own commands (an overlay closing), so the rest land where it left things.
        return rest.length > 0
          ? [next, [...cmds, send<ShellMsg>(...rest.map((key) => ({ type: "key" as const, key })))]]
          : [next, cmds];
      }
      case "paste":
        // Text only lands where text is being taken: the overlay, or a tab with a field focused.
        if (model.overlay) return toOverlay(model, msg);
        return capturing(model) ? toTab(model, model.active, msg) : [model, []];
      case "resize":
        return toAll({ ...model, columns: msg.columns, rows: msg.rows }, msg);
      case "tab":
        return toTab(model, msg.tab, msg.msg);
      case "overlay":
        return toOverlay(model, msg.msg);
      case "app/switchTab":
        return show(model, msg.tab, msg.focus);
      case "app/load":
        if (!msg.force && model.requested.includes(msg.resource)) return [model, []];
        return load(model, msg.resource);
      case "app/loaded": {
        const gens = { ...model.gens, [msg.resource]: model.gens[msg.resource] + 1 };
        return loaded({ ...model, gens }, msg.resource, msg.result);
      }
      case "app/values": {
        const values = { ...model.values, ...msg.values };
        const stale = affectedResources(model.values, values).filter((id) =>
          model.requested.includes(id),
        );
        return loadAll({ ...model, values }, stale);
      }
      case "app/toast":
        return withToast(model, msg.text, msg.tone);
      case "app/openLabels":
        return open(model, "labels", msg.request);
      case "app/confirm":
        return open(model, "confirm", msg.request);
      case "app/closeOverlay":
        return [{ ...model, overlay: null }, []];
      case "app/runFinished":
        return [{ ...model, summaries: [...model.summaries, msg.summary] }, []];
      case "app/error":
        return [{ ...model, error: msg.error }, []];
      case "app/quit":
        return quit(model);
      case "shell/mounted":
        // A tab's init may have asked already: loading again would read the console twice.
        return loadAll(
          model,
          (["console", "presets"] as const).filter((id) => !model.requested.includes(id)),
        );
      case "shell/loaded":
        if (msg.gen !== model.gens[msg.resource]) return [model, []];
        return loaded(model, msg.resource, msg.result);
      case "shell/toastExpired":
        return model.toast?.id === msg.id ? [{ ...model, toast: null }, []] : [model, []];
      case "shell/help":
        return open(model, "help", helpRequest(model));
      case "shell/quitNow":
        return quit(model, true);
    }
  }

  /**
   * The footer's keys, the one place keys are listed: the tab's at the left, the global ones at the
   * right end. Only the overlay's while one is open, only the tab's while its own dialog is open (both
   * take every key), and no q or ? while the tab takes text.
   */
  function footer(model: ShellModel): { hints: Hint[]; global: Hint[] } {
    if (model.overlay) {
      const module = overlays[model.overlay.id];
      return { hints: module.hints(model.overlay.model, ctx(model)), global: [] };
    }
    const own = tab(model).hints(model.tabs[model.active], ctx(model));
    if (modal(model)) return { hints: own, global: [] };
    const global = capturing(model)
      ? GLOBAL_HINTS.filter((h) => h.keys !== "?" && h.keys !== "q")
      : GLOBAL_HINTS;
    return { hints: own, global };
  }

  /** Every key the footer may show, in order. */
  function hints(model: ShellModel): Hint[] {
    const { hints: own, global } = footer(model);
    return [...own, ...global];
  }

  /** The header's tabs, Check badged with its problem count once it has run. */
  function headerTabs(model: ShellModel): HeaderTab[] {
    const check = model.resources.check;
    const problems =
      check.state === "ready" ? checkCounts((check.value as CheckData).sections).problems : 0;
    return TAB_ORDER.map((id) => ({
      id,
      title: tab(model, id).title,
      ...(id === "check" && problems > 0 ? { badge: String(problems) } : {}),
    }));
  }

  return {
    init,
    update,
    ctx,
    hints,
    footer,
    headerTabs,
    tabModule: (id: TabId) => deps.tabs[id],
    overlayModule: (id: OverlayId) => overlays[id],
  };
}

export type Shell = ReturnType<typeof createShell>;
