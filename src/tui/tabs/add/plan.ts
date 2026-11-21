// ABOUTME: The Add tab's plan table as data: what a run does per row, notes under the table, live progress, the summary.
// ABOUTME: Pure; the review and run pages draw it, and the same rows switch from plan to live statuses once a run starts.

import {
  type FilamentProfile,
  resultFailed,
  type Status,
  type SyncResult,
} from "../../../models.js";
import type { ProfilePlan } from "../../../planPreview.js";
import type { Edits } from "../../../presetEdit.js";
import type { SyncEvent, SyncStage } from "../../../sync.js";
import type { RunSummary } from "../../core/types.js";
import { formatGrams, formatRange, plural } from "../../ui/format.js";
import { textWidth } from "../../ui/text.js";
import { swatchOf } from "./catalog.js";

export type Tone = "new" | "same" | "change";

/** What the run does to the profile's presets: all new, kept (or replaced when overwriting), or some of each. */
export function presetPlanText(
  plan: ProfilePlan,
  overwrite: boolean,
): { text: string; tone: Tone } {
  const { presets, existingPresets } = plan;
  if (existingPresets === 0) return { text: "+ new", tone: "new" };
  const tone: Tone = overwrite ? "change" : "same";
  if (existingPresets < presets)
    return { text: `${existingPresets}/${presets} ${overwrite ? "replace" : "kept"}`, tone };
  return { text: overwrite ? "↻ replace" : "= kept", tone };
}

/** What the run does on SpoolEase: add or update the custom filament row, and add a spool; null when SpoolEase wasn't read. */
export function spoolEasePlanText(plan: ProfilePlan): { text: string; tone: Tone } | null {
  const { filament, spool } = plan;
  if (!filament) return null;
  const row = filament.state === "new" ? "add" : filament.state === "update" ? "update" : "";
  const parts = [row, spool === "create" ? "spool" : ""].filter(Boolean);
  const text = parts.length > 0 ? parts.join(" + ") : spool === "exists" ? "has spool" : "listed";
  const tone: Tone = filament.state === "update" ? "change" : parts.length > 0 ? "new" : "same";
  return { text, tone };
}

export interface RowProgress {
  preset?: Status;
  spool?: Status;
}

/** A status column's cell: the plan before the run, then its status, a spinner while its stage works, or a dot. */
export type StatusCell =
  | { kind: "plan"; text: string; tone: Tone }
  | { kind: "status"; status: Status }
  | { kind: "working" }
  | { kind: "none" };

export interface PlanRow {
  swatch: string;
  name: string;
  brand: string;
  material: string;
  /** The nozzle range SpoolEase gets (a kept preset's, or the profile's with the plan's edits). */
  temps: string;
  code: string;
  empty: string;
  preset: StatusCell;
  spool: StatusCell;
  /** The row's preset has edits for the run (✎ before the name). */
  edited?: boolean;
}

function statusCell(status: Status | undefined, active: boolean): StatusCell {
  if (status) return { kind: "status", status };
  return active ? { kind: "working" } : { kind: "none" };
}

/**
 * One row per profile: the plan until the run starts (a stage or any status in), then live statuses.
 * plans is null when the plan couldn't be worked out.
 */
export function planRows(
  profiles: FilamentProfile[],
  plans: ProfilePlan[] | null,
  progress: RowProgress[],
  stage: SyncStage | null,
  overwrite: boolean,
): PlanRow[] {
  const started = stage !== null || progress.length > 0;
  return profiles.map((profile, index) => {
    const plan = plans?.[index];
    const range = plan?.nozzleRange ?? { low: profile.nozzleTempMin, high: profile.nozzleTempMax };
    const row = progress[index] ?? {};
    const planned = (cell: { text: string; tone: Tone } | null | undefined): StatusCell =>
      cell ? { kind: "plan", ...cell } : { kind: "none" };
    return {
      swatch: swatchOf(profile),
      name: profile.name,
      brand: profile.brand,
      material: profile.material,
      temps: formatRange(range.low, range.high),
      code: profile.filamentId,
      empty: profile.coreWeight ? formatGrams(profile.coreWeight) : "–",
      preset: started
        ? statusCell(row.preset, stage === "presets")
        : planned(plan && presetPlanText(plan, overwrite)),
      spool: started
        ? statusCell(row.spool, stage === "spools")
        : planned(plan && spoolEasePlanText(plan)),
    };
  });
}

export interface Note {
  text: string;
  tone: "warning" | "failed" | "muted";
}

/** Where a filament's plan edits go: the presets the run writes for it, or nowhere when it keeps them all. */
function editNote(
  profile: FilamentProfile,
  plan: ProfilePlan,
  overwrite: boolean,
  count: number,
): Note {
  const written = overwrite ? plan.presets : plan.presets - plan.existingPresets;
  const changes = plural(count, "change");
  const goes = count === 1 ? "goes" : "go";
  if (written === 0)
    return {
      text: `✎ ${profile.filamentId}: the run keeps its presets, so its ${changes} ${goes} nowhere`,
      tone: "failed",
    };
  return {
    text: `✎ ${profile.filamentId}: ${changes} ${goes} into the ${plural(written, "preset")} the run writes`,
    tone: "warning",
  };
}

/** What the plan's words mean where it matters: each edit and update, and counts of kept presets and existing spools. */
export function planNotes(
  profiles: FilamentProfile[],
  plans: ProfilePlan[],
  overwrite: boolean,
  edits: ReadonlyMap<string, Edits>,
): Note[] {
  const notes: Note[] = [];
  plans.forEach((plan, index) => {
    const profile = profiles[index];
    const count = profile ? (edits.get(profile.filamentId)?.size ?? 0) : 0;
    if (profile && count > 0) notes.push(editNote(profile, plan, overwrite, count));
  });
  plans.forEach((plan, index) => {
    const profile = profiles[index];
    if (profile && plan.filament?.state === "update")
      notes.push({
        text: `↻ ${profile.filamentId} is ${plan.filament.listed} on SpoolEase; the run changes it to ${plan.filament.becomes}`,
        tone: "warning",
      });
  });
  const kept = overwrite ? 0 : plans.reduce((sum, plan) => sum + plan.existingPresets, 0);
  if (kept > 0)
    notes.push({
      text: `= kept: ${plural(kept, "preset")} ${kept === 1 ? "is" : "are"} there already and ${kept === 1 ? "stays as it is" : "stay as they are"}; Overwrite presets in Settings replaces ${kept === 1 ? "it" : "them"}`,
      tone: "muted",
    });
  const spooled = plans.filter((plan) => plan.spool === "exists").length;
  if (spooled > 0)
    notes.push({
      text:
        spooled === 1
          ? "has spool: the console has a spool of it already, so it gets no new one"
          : `has spool: the console has spools of ${spooled} of them already, so they get no new one`,
      tone: "muted",
    });
  return notes;
}

export const STAGE_LABELS: Record<SyncStage, string> = {
  presets: "Writing BambuStudio presets",
  "key-check": "Checking SpoolEase security key",
  "custom-filaments": "Uploading custom filaments to SpoolEase",
  spools: "Creating SpoolEase spools",
};

/** The progress with a preset or spool event recorded at its row; other events change nothing. */
export function applyEvent(progress: RowProgress[], event: SyncEvent): RowProgress[] {
  if (event.type !== "preset" && event.type !== "spool") return progress;
  const next = [...progress];
  next[event.index] = { ...next[event.index], [event.type]: event.status };
  return next;
}

/** Profiles the run is done with: both their preset and their SpoolEase status are in. */
export function finishedProfiles(progress: RowProgress[]): number {
  return progress.filter((row) => row?.preset && row.spool).length;
}

/**
 * How far the run is, 0 to 100: each profile is two steps, its preset and its SpoolEase status, since
 * every preset is written before any spool and counting whole profiles would leave the bar empty meanwhile.
 */
export function runPercent(progress: RowProgress[], total: number): number {
  if (total <= 0) return 0;
  const steps = progress.reduce(
    (sum, row) => sum + (row?.preset ? 1 : 0) + (row?.spool ? 1 : 0),
    0,
  );
  return (steps / (2 * total)) * 100;
}

export interface RunOutcome {
  summary: RunSummary;
  toast: { text: string; tone: "ok" | "failed" };
  /** The spools the run created, in profile order, for their labels. */
  spoolIds: string[];
}

/** What a finished run tells the session (summary, exit code), the footer (toast) and the labels offer. */
export function runOutcome(results: SyncResult[], sourceLabel: string): RunOutcome {
  const failed = results.filter(resultFailed);
  const spoolIds = results.map((r) => r.spoolId).filter((id): id is string => Boolean(id));
  const spools = spoolIds.length > 0 ? `, ${plural(spoolIds.length, "new spool")}` : "";
  const failures = failed.length > 0 ? `, ${failed.length} failed` : "";
  const lines = [
    `${plural(results.length, "filament")} from ${sourceLabel}: ${results.length - failed.length} written${failures}${spools}`,
    ...failed.map((r) => `${r.profileName}: ${r.detail}`),
  ];
  if (failed.length > 0)
    return {
      summary: { ok: false, lines, exitCode: 1 },
      toast: {
        text: `${failed.length} of ${plural(results.length, "filament")} failed`,
        tone: "failed",
      },
      spoolIds,
    };
  const added = spoolIds.length > 0 ? ` · ${plural(spoolIds.length, "new spool")}` : "";
  return {
    summary: { ok: true, lines },
    toast: { text: `${plural(results.length, "filament")} added${added}`, tone: "ok" },
    spoolIds,
  };
}

export type TableColumn =
  | "name"
  | "brand"
  | "material"
  | "temps"
  | "code"
  | "empty"
  | "preset"
  | "spool";

export const TABLE_COLUMNS: readonly TableColumn[] = [
  "name",
  "brand",
  "material",
  "temps",
  "code",
  "empty",
  "preset",
  "spool",
];

export const COLUMN_TITLES: Record<TableColumn, string> = {
  name: "Name",
  brand: "Brand",
  material: "Material",
  temps: "Nozzle",
  code: "Code",
  empty: "Empty",
  preset: "Preset",
  spool: "SpoolEase",
};

/** The list's own columns before and after the cells: gutter, chip and its gap, scroll thumb. */
export const LIST_EDGES = 5;

const STATUS_LABELS: Record<Status, string> = {
  written: "✓ written",
  failed: "✗ failed",
  skipped: "- skipped",
  planned: "! planned",
};

/** A status cell's words: the plan before the run, then its status. */
export function statusLabel(cell: StatusCell): string {
  switch (cell.kind) {
    case "plan":
      return cell.text;
    case "status":
      return STATUS_LABELS[cell.status];
    case "working":
      return "… working";
    case "none":
      return "·";
  }
}

/** The words a status column can show during a run, so it doesn't change width when the run starts. */
const RUN_LABELS = ["✓ written", "✗ failed", "- skipped", "… working"];

/**
 * The name without what other places already say: the brand in front (SpoolmanDB names start with it)
 * and the material's word. Kept whole when nothing would be left.
 */
export function shortName(
  name: string,
  brand: string,
  material: string,
  stripBrand: boolean,
  stripMaterial: boolean,
): string {
  let rest = name;
  if (stripBrand && brand && rest.toLowerCase().startsWith(`${brand.toLowerCase()} `))
    rest = rest.slice(brand.length + 1);
  if (stripMaterial && material) {
    const words = rest.split(" ");
    const at = words.findIndex((w) => w.toLowerCase() === material.toLowerCase());
    if (at >= 0) words.splice(at, 1);
    rest = words.join(" ");
  }
  return rest.trim() || name;
}

export interface PlanLayout {
  /** Each column's cell width; 0 leaves the column out. */
  widths: Record<TableColumn, number>;
  /** The brand and material every row shares (shown in the title instead of a column), else null. */
  brand: string | null;
  material: string | null;
  /** Whether names leave out their brand and material, said elsewhere (a column or the title). */
  stripBrand: boolean;
  stripMaterial: boolean;
}

/** Below this the name would be cut before anything else gave way. */
const NAME_MIN = 14;
/** At most this wide, so a long brand or material doesn't take the name's room. */
const BRAND_MAX = 14;
const MATERIAL_MAX = 10;

/**
 * The plan table's columns fitted to `width` (the list's width), sized from the rows' own values.
 * A brand or material all rows share moves to the title; names leave out what a column or the title
 * says. When the name would be cut, the code goes first, then the empty weight, then the brand and
 * material columns (the names then say them); past that the status columns and temperatures shrink.
 */
export function planLayout(rows: PlanRow[], width: number): PlanLayout {
  // A column's span is its cell plus the gap after it; the last cell's gap is the one LIST_EDGES leaves.
  const room = Math.max(0, width - LIST_EDGES + 1);
  const span = (title: string, texts: string[], max = Number.POSITIVE_INFINITY) =>
    Math.min(max, Math.max(textWidth(title), ...texts.map(textWidth))) + 1;
  const shared = (pick: (row: PlanRow) => string): string | null => {
    const [first] = rows;
    return first && rows.every((row) => pick(row) === pick(first)) ? pick(first) : null;
  };
  const brand = shared((r) => r.brand);
  const material = shared((r) => r.material);
  const shown: Record<TableColumn, number> = {
    name: 0,
    brand:
      brand === null
        ? span(
            COLUMN_TITLES.brand,
            rows.map((r) => r.brand),
            BRAND_MAX,
          )
        : 0,
    material:
      material === null
        ? span(
            COLUMN_TITLES.material,
            rows.map((r) => r.material),
            MATERIAL_MAX,
          )
        : 0,
    temps: span(
      COLUMN_TITLES.temps,
      rows.map((r) => r.temps),
    ),
    code: span(
      COLUMN_TITLES.code,
      rows.map((r) => r.code),
    ),
    empty: span(
      COLUMN_TITLES.empty,
      rows.map((r) => r.empty),
    ),
    preset: span(COLUMN_TITLES.preset, [...rows.map((r) => statusLabel(r.preset)), ...RUN_LABELS]),
    // A column no row has anything in (SpoolEase skipped) says nothing: it's left out.
    spool: rows.every(
      (r) => r.spool.kind === "none" || (r.spool.kind === "status" && r.spool.status === "skipped"),
    )
      ? 0
      : span(COLUMN_TITLES.spool, [...rows.map((r) => statusLabel(r.spool)), ...RUN_LABELS]),
  };
  let stripBrand = true;
  let stripMaterial = true;
  const nameWant = () =>
    span(
      COLUMN_TITLES.name,
      rows.map(
        (r) =>
          `${r.edited ? "✎ " : ""}${shortName(r.name, r.brand, r.material, stripBrand, stripMaterial)}`,
      ),
    );
  const fixed = () =>
    TABLE_COLUMNS.reduce((sum, key) => sum + (key === "name" ? 0 : shown[key]), 0);
  const fits = () => fixed() + Math.min(nameWant(), NAME_MIN + 1) <= room;
  for (const drop of ["code", "empty", "columns"] as const) {
    if (fits()) break;
    if (drop !== "columns") {
      shown[drop] = 0;
      continue;
    }
    if (shown.brand > 0) {
      shown.brand = 0;
      stripBrand = false;
    }
    if (shown.material > 0) {
      shown.material = 0;
      stripMaterial = false;
    }
  }
  shown.name = Math.max(0, room - fixed());
  if (shown.name < Math.min(nameWant(), NAME_MIN + 1)) {
    const fitted = fitColumns({ ...shown, name: Math.min(nameWant(), NAME_MIN + 1) }, room, [
      ["spool", 9],
      ["preset", 7],
      ["temps", 8],
      ["name", 7],
    ]);
    Object.assign(shown, fitted);
    shown.name = Math.max(shown.name, room - fixed());
  }
  const widths = Object.fromEntries(
    TABLE_COLUMNS.map((key) => [key, shown[key] > 0 ? shown[key] - 1 : 0]),
  ) as Record<TableColumn, number>;
  return { widths, brand, material, stripBrand, stripMaterial };
}

/**
 * Column widths fitted to `available` columns: the columns over it come off the `shrink` columns in
 * order, each down to its minimum, in whole columns, so no cell is laid out a fraction wide.
 */
export function fitColumns<K extends string>(
  widths: Readonly<Record<K, number>>,
  available: number,
  shrink: readonly (readonly [K, number])[],
): Record<K, number> {
  const fitted: Record<K, number> = { ...widths };
  const total = (Object.values(widths) as number[]).reduce((sum, width) => sum + width, 0);
  let over = Math.max(0, Math.ceil(total - available));
  for (const [key, min] of shrink) {
    const taken = Math.min(over, Math.max(0, fitted[key] - min));
    fitted[key] -= taken;
    over -= taken;
  }
  return fitted;
}
