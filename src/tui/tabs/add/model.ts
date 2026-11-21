// ABOUTME: The Add tab's model: pages Find → Weights → Review → Run, the selection, session colors, choices and edits.
// ABOUTME: init and the helpers that read the catalog and import out of the model and the shell's resources.

import type { FilamentProfile, SyncResult } from "../../../models.js";
import type { ProfilePlan } from "../../../planPreview.js";
import type { Edits } from "../../../presetEdit.js";
import type { Catalog } from "../../../spoolmanDb.js";
import type { WeightChoice, WeightGroup } from "../../../spoolWeights.js";
import type { SyncStage } from "../../../sync.js";
import { send } from "../../core/program.js";
import type { AppMsg, Ctx, Resource, StartOptions, Step } from "../../core/types.js";
import type { FormValues } from "../../core/values.js";
import type { TextState } from "../../ui/textField.js";
import {
  type Entry,
  importName,
  importSourceOf,
  type Level,
  type Sources,
  selectedEntries,
} from "./catalog.js";
import { importCmd } from "./cmds.js";
import type { ColorDialog } from "./color.js";
import type { RowProgress } from "./plan.js";
import { consoleSetup } from "./targets.js";

export type PageId = "find" | "weights" | "review" | "run";

export const PAGE_ORDER: readonly PageId[] = ["find", "weights", "review", "run"];

export interface FindFrame {
  level: Level;
  cursor: number;
}

/** A name search over the whole catalog: the query being typed, or the results list focused to tick. */
export interface SearchModel {
  text: TextState;
  cursor: number;
  focus: "query" | "list";
}

export interface ImportModel {
  /** The file or URL from the settings; null when the source isn't one. */
  source: string | null;
  state: "none" | "loading" | "ready" | "failed";
  profiles: FilamentProfile[];
  error: string;
}

export interface WeightsModel {
  state: "idle" | "loading" | "ready" | "failed";
  /** The selection (and console) the weights were read for; a different one reads again. */
  signature: string;
  /** The ticked profiles as read, before any weight is applied, with where each comes from. */
  profiles: FilamentProfile[];
  origins: ("db" | "import")[];
  groups: WeightGroup[];
  /** The brands that need a choice: SpoolEase's lists have none or several rows for them. */
  prompts: WeightGroup[];
  warnings: string[];
  /** The brand being chosen for, an index into prompts, and the cursor in its items. */
  step: number;
  cursor: number;
  error: string;
  /** The console refused the key or couldn't be reached: the fix is in Settings. */
  keyRejected: boolean;
}

export interface ReviewModel {
  state: "idle" | "loading" | "ready";
  /** Which plan read is current; a reply for an older one is dropped. */
  seq: number;
  /** The profiles the run gets, with the chosen empty spool weights. */
  profiles: FilamentProfile[];
  plans: ProfilePlan[] | null;
  warnings: string[];
  /** The highlighted row. */
  cursor: number;
  /** Why the run can't start (settings), shown until the next key. */
  error: string;
}

export interface RunModel {
  state: "running" | "done" | "failed";
  profiles: FilamentProfile[];
  plans: ProfilePlan[] | null;
  progress: RowProgress[];
  stage: SyncStage | null;
  warnings: string[];
  results: SyncResult[];
  /** The run's error when it failed before finishing. */
  error: string;
  spoolIds: string[];
  /** Where the profiles came from, for the summary. */
  sourceLabel: string;
}

export interface AddModel {
  page: PageId;
  /** The drill-down levels, top last; each keeps its cursor for going back up. */
  stack: FindFrame[];
  search: SearchModel | null;
  /** Ticked profiles by selection key (catalog.ts dbKey/importKey); kept until a run finishes. */
  selected: ReadonlySet<string>;
  /** Colors added this session with "Other color…": part of the catalog until the TUI exits. */
  extra: FilamentProfile[];
  imported: ImportModel;
  dialog: ColorDialog | null;
  weights: WeightsModel;
  /** Empty spool weight per brand key; kept until a run finishes. */
  weightChoices: ReadonlyMap<string, WeightChoice>;
  /** Edits to the presets a run writes, by filament ID; kept until a run finishes. */
  planEdits: ReadonlyMap<string, Edits>;
  review: ReviewModel;
  run: RunModel | null;
  /** A one-line message for the last key (what it needs first), cleared by the next. */
  notice: string;
  /** The catalog was asked for, so it isn't asked for again while the shell loads it. */
  catalogRequested: boolean;
}

export function emptyWeights(): WeightsModel {
  return {
    state: "idle",
    signature: "",
    profiles: [],
    origins: [],
    groups: [],
    prompts: [],
    warnings: [],
    step: 0,
    cursor: 0,
    error: "",
    keyRejected: false,
  };
}

export function emptyReview(seq = 0): ReviewModel {
  return { state: "idle", seq, profiles: [], plans: null, warnings: [], cursor: 0, error: "" };
}

/** The top of Find: both sources when there's an import (on the import), else straight into the brands. */
export function rootStack(hasImport: boolean): FindFrame[] {
  return hasImport
    ? [{ level: { kind: "root" }, cursor: 1 }]
    : [{ level: { kind: "brands" }, cursor: 0 }];
}

function catalogOf(resource: Resource<Catalog>): Catalog | null {
  if (resource.state === "ready") return resource.value;
  if (resource.state === "loading" || resource.state === "failed") return resource.previous ?? null;
  return null;
}

const NO_PROFILES: FilamentProfile[] = [];

let lastDb: {
  listed: FilamentProfile[];
  extra: FilamentProfile[];
  profiles: FilamentProfile[];
} | null = null;

/**
 * The catalog's profiles plus the session's own colors (unless the catalog has them by now). The same
 * catalog and colors give the same array, which catalog.ts indexes once.
 */
export function dbProfiles(model: AddModel, ctx: Ctx): FilamentProfile[] {
  const listed = catalogOf(ctx.resources.catalog)?.profiles ?? NO_PROFILES;
  if (model.extra.length === 0) return listed;
  if (lastDb && lastDb.listed === listed && lastDb.extra === model.extra) return lastDb.profiles;
  const ids = new Set(listed.map((p) => p.filamentId));
  const profiles = [...listed, ...model.extra.filter((p) => !ids.has(p.filamentId))];
  lastDb = { listed, extra: model.extra, profiles };
  return profiles;
}

export function catalogWarnings(ctx: Ctx): string[] {
  return catalogOf(ctx.resources.catalog)?.warnings ?? [];
}

export function sourcesOf(model: AddModel, ctx: Ctx): Sources {
  return {
    db: dbProfiles(model, ctx),
    imported: model.imported.profiles,
    importName: model.imported.source === null ? null : importName(model.imported.source),
  };
}

export function ticked(model: AddModel, ctx: Ctx): Entry[] {
  return selectedEntries(sourcesOf(model, ctx), model.selected);
}

/** Asks the shell for the catalog the first time Add needs it. */
export function requestCatalog(model: AddModel, ctx: Ctx): Step<AddModel> {
  if (model.catalogRequested || ctx.resources.catalog.state !== "idle") return [model, []];
  return [
    { ...model, catalogRequested: true },
    [send<AppMsg>({ type: "app/load", resource: "catalog" })],
  ];
}

export function importModel(source: string | null): ImportModel {
  return { source, state: source === null ? "none" : "loading", profiles: [], error: "" };
}

/**
 * Whether the app opens on Add: something to add was given, or there's no console to show (the shell's
 * landing rule). Only then is SpoolmanDB loaded right away; elsewhere, on Add's first key.
 */
export function landsOnAdd(values: FormValues, start: StartOptions): boolean {
  return (
    start.query.trim() !== "" || values.source.trim() !== "" || consoleSetup(values) !== "ready"
  );
}

export function init(ctx: Ctx, start: StartOptions): Step<AddModel> {
  const source = importSourceOf(ctx.values);
  const query = start.query.trim();
  const model: AddModel = {
    page: "find",
    stack: rootStack(source !== null),
    search: query
      ? { text: { value: query, cursor: query.length }, cursor: 0, focus: "list" }
      : null,
    selected: new Set(),
    extra: [],
    imported: importModel(source),
    dialog: null,
    weights: emptyWeights(),
    weightChoices: new Map(),
    planEdits: new Map(),
    review: emptyReview(),
    run: null,
    notice: "",
    catalogRequested: false,
  };
  // SpoolmanDB is a download: fetched now only when the app opens on Add, else on Add's first key.
  const [requested, cmds] = landsOnAdd(ctx.values, start)
    ? requestCatalog(model, ctx)
    : [model, []];
  return [requested, [...cmds, ...(source === null ? [] : [importCmd(source)])]];
}
