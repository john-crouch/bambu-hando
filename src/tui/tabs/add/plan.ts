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
import { swatchOf, tempsText } from "./catalog.js";

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
      temps: tempsText(range.low, range.high),
      code: profile.filamentId,
      empty: profile.coreWeight ? `${profile.coreWeight} g` : "–",
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

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
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
      text: `= kept: ${plural(kept, "preset")} ${kept === 1 ? "is" : "are"} there already and ${kept === 1 ? "stays as it is" : "stay as they are"} (Overwrite presets in Settings replaces ${kept === 1 ? "it" : "them"})`,
      tone: "muted",
    });
  const spooled = plans.filter((plan) => plan.spool === "exists").length;
  if (spooled > 0)
    notes.push({
      text: `has spool: the console has a spool of ${plural(spooled, "filament")} already, so ${spooled === 1 ? "it gets" : "they get"} no new one`,
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
  const lines = [
    `${plural(results.length, "filament")} from ${sourceLabel}: ${results.length - failed.length} written, ${failed.length} failed${spools}`,
    ...failed.map((r) => `${r.profileName}: ${r.detail}`),
  ];
  if (failed.length > 0)
    return {
      summary: { ok: false, lines, exitCode: 1 },
      toast: {
        text: `✗ ${failed.length} of ${plural(results.length, "filament")} failed`,
        tone: "failed",
      },
      spoolIds,
    };
  const added = spoolIds.length > 0 ? ` · ${plural(spoolIds.length, "new spool")}` : "";
  return {
    summary: { ok: true, lines },
    toast: { text: `✓ ${plural(results.length, "filament")} added${added}`, tone: "ok" },
    spoolIds,
  };
}

// The swatch shows the color, so the table leaves its RGBA out and keeps the width for what the run does.
export const PLAN_COLUMNS = {
  swatch: 3,
  name: 22,
  brand: 12,
  material: 10,
  temps: 10,
  code: 9,
  empty: 7,
  preset: 12,
  spool: 14,
} as const;

export type PlanColumn = keyof typeof PLAN_COLUMNS;

// On a narrow panel the name gives up columns first, down to this, then the brand. Below that the
// status columns give way down to a whole badge (" SKIPPED " plus a gap, so the header fits too), then
// material and temperatures, then name and brand again. Code and empty weight never shrink: the code
// is the ID that links preset, CSV and spool. Past every minimum the rows are clipped.
export const PLAN_SHRINK: readonly (readonly [PlanColumn, number])[] = [
  ["name", 10],
  ["brand", 5],
  ["spool", 10],
  ["preset", 10],
  ["material", 6],
  ["temps", 8],
  ["name", 6],
  ["brand", 4],
];

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
