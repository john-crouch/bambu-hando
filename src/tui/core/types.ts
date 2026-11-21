// ABOUTME: The TUI's contract: app messages, shared resources, the context every tab sees, and the tab/overlay modules.
// ABOUTME: Tabs and overlays are model/update/view modules the shell (App.tsx) routes messages to; none reads input itself.

import type { ReactElement } from "react";
import type { CustomFilament, SpoolRecord } from "../../spoolease.js";
import type { Catalog } from "../../spoolmanDb.js";
import type { CheckSection, UserPreset } from "../../syncCheck.js";
import type { KeyPress } from "./keys.js";
import type { Cmd } from "./program.js";
import type { FormValues } from "./values.js";

export type TabId = "spools" | "add" | "presets" | "check" | "settings";

export const TAB_ORDER: readonly TabId[] = ["spools", "add", "presets", "check", "settings"];

/** Something loaded in the background. previous keeps the last good value on screen while reloading or after a failure. */
export type Resource<T> =
  | { state: "idle" }
  | { state: "loading"; previous?: T }
  | { state: "ready"; value: T; at: number }
  | { state: "failed"; error: string; previous?: T };

/** The console's spools and the custom filaments they're listed by (keyed by filament code). */
export interface ConsoleData {
  spools: SpoolRecord[];
  filaments: ReadonlyMap<string, CustomFilament>;
}

export interface PresetsData {
  presets: UserPreset[];
  warnings: string[];
}

export interface CheckData {
  sections: CheckSection[];
  warnings: string[];
  presets: UserPreset[];
}

export interface Resources {
  /** idle when SpoolEase is skipped or not set up. */
  console: Resource<ConsoleData>;
  /** The preset folder's own filament presets. */
  presets: Resource<PresetsData>;
  /** SpoolmanDB, loaded the first time Add needs it. */
  catalog: Resource<Catalog>;
  /** The sync check; idle without a console. */
  check: Resource<CheckData>;
}

export type ResourceId = keyof Resources;

/** One line of the footer and of the help page: keys as shown ("↑↓", "space", "ctrl+k") and what they do. */
export interface Hint {
  keys: string;
  label: string;
  /** Footer shows only primary hints when space is short; help shows all. */
  primary?: boolean;
}

/** An entry of the command palette: a name to search and the message it sends. */
export interface PaletteCommand {
  title: string;
  /** Shown dim after the title, e.g. the tab it's in. */
  detail?: string;
  msg: AppMsg;
}

/** What `bambu-hando tui` was started with, beyond the settings: decides the landing tab and Add's search. */
export interface StartOptions {
  /** --brand/--material/--match joined, as FormValues.query. */
  query: string;
}

/** What every tab and overlay sees, read-only. */
export interface Ctx {
  /** The session's settings (Settings tab edits them through app/values). */
  values: FormValues;
  resources: Resources;
  /** The terminal, and the body's share of it once the header and footer are drawn. */
  columns: number;
  rows: number;
  bodyColumns: number;
  bodyRows: number;
  /** Today, for "added 3 days ago" and stale checks; injected so tests are stable. */
  now: number;
}

/** A run's result as the session summary keeps it: printed after the TUI exits, and decides the exit code. */
export interface RunSummary {
  ok: boolean;
  lines: string[];
  /**
   * The exit code this outcome asks for: 2 for a setup error (rejected key, missing system profiles),
   * else 1 when ok is false. The session exits with the highest one, so a failure is never forgotten.
   */
  exitCode?: 1 | 2;
}

export type OverlayId = "help" | "palette" | "labels" | "confirm";

/** A write the confirm dialog shows before it happens: every target named, then [a] sends onApply. */
export interface ConfirmRequest {
  title: string;
  lines: string[];
  /** Sent when the user presses a. */
  onApply: AppMsg;
  applyLabel?: string;
}

/** Labels for these spools; back is where the overlay returns (it always returns where it opened). */
export interface LabelsRequest {
  spoolIds: string[];
  /** True when the spools were just created by a run: the form says so. */
  fresh: boolean;
}

/**
 * Messages the shell handles. Tabs talk to the shell and each other only through these; a tab's own
 * messages travel wrapped as { type: "tab", tab, msg } so they reach that tab's update.
 */
export type AppMsg =
  | { type: "key"; key: KeyPress }
  | { type: "paste"; text: string }
  | { type: "resize"; columns: number; rows: number }
  | { type: "tab"; tab: TabId; msg: TabMsg }
  | { type: "overlay"; msg: TabMsg }
  | { type: "app/switchTab"; tab: TabId }
  | { type: "app/load"; resource: ResourceId; force?: boolean }
  | { type: "app/loaded"; resource: ResourceId; result: Resource<unknown> }
  | { type: "app/values"; values: Partial<FormValues> }
  | { type: "app/toast"; text: string; tone?: "ok" | "warning" | "failed" }
  | { type: "app/openLabels"; request: LabelsRequest }
  | { type: "app/confirm"; request: ConfirmRequest }
  | { type: "app/closeOverlay" }
  | { type: "app/runFinished"; summary: RunSummary }
  | { type: "app/error"; error: string }
  | { type: "app/quit" };

/** A tab's own messages: { type } plus whatever it needs. */
export interface TabMsg {
  type: string;
  [field: string]: unknown;
}

/** What an update returns: the next model and commands, which dispatch AppMsgs. */
export type Step<M> = [M, Cmd<AppMsg>[]];

/** A tab: model, pure update, view. The shell keeps each tab's model while another tab is shown. */
export interface TabModule<M> {
  id: TabId;
  title: string;
  init(ctx: Ctx, start: StartOptions): Step<M>;
  /**
   * Keys (only those the shell doesn't take: see capturesText), the tab's own messages, resize,
   * app/loaded for any resource (so a tab can react when data arrives), and app/switchTab each time
   * the tab is shown (so it can load what it needs on its first visit).
   */
  update(model: M, msg: AppMsg | TabMsg, ctx: Ctx): Step<M>;
  View(props: { model: M; ctx: Ctx }): ReactElement;
  /** The keys that work right now, in footer order. */
  hints(model: M, ctx: Ctx): Hint[];
  /**
   * True while a text field or filter has focus: the shell then passes q, ?, / and letters to the tab
   * instead of acting on them (tab, ctrl+k and ctrl+c stay global).
   */
  capturesText(model: M): boolean;
  /** Entries for the command palette. */
  commands?(model: M, ctx: Ctx): PaletteCommand[];
}

/** An overlay: a centered panel over the body that takes all keys while open (ctrl+c stays global). */
export interface OverlayModule<M, Req> {
  id: OverlayId;
  init(request: Req, ctx: Ctx): Step<M>;
  update(model: M, msg: AppMsg | TabMsg, ctx: Ctx): Step<M>;
  View(props: { model: M; ctx: Ctx }): ReactElement;
  hints(model: M, ctx: Ctx): Hint[];
}

/** Wraps a tab's own message so the shell routes it to that tab. */
export function toTab(tab: TabId, msg: TabMsg): AppMsg {
  return { type: "tab", tab, msg };
}
