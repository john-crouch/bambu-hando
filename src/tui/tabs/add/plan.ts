// ABOUTME: The Add tab's plan table as data: what a run does per row, notes under the table, live progress, the summary.
// ABOUTME: Pure; the review and run pages draw it, and the same rows switch from plan to live statuses once a run starts.

import {
  type FilamentProfile,
  resultFailed,
  type Status,
  type SyncResult,
} from "../../../models.js";
import type { ProfilePlan } from "../../../planPreview.js";
import type { EditChange, Edits } from "../../../presetEdit.js";
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
  named: EditChange[] | undefined,
): Note {
  const written = overwrite ? plan.presets : plan.presets - plan.existingPresets;
  // The editor's own words for each change when it made them ("Nozzle 245°C → 250°C"), else a count.
  const changes =
    named && named.length > 0
      ? named.map((c) => `${c.label} ${c.from} → ${c.to}`).join(", ")
      : plural(count, "change");
  const goes = (named && named.length > 0 ? named.length : count) === 1 ? "goes" : "go";
  if (written === 0)
    return {
      text: `✎ ${profile.name}: the run keeps its presets, so ${named?.length ? changes : `its ${changes}`} ${goes} nowhere`,
      tone: "failed",
    };
  const presets = written === 1 ? "preset" : plural(written, "preset");
  return {
    text: `✎ ${profile.name}: ${changes} ${goes} into the ${presets} the run writes`,
    tone: "warning",
  };
}

/** A custom filament row as planPreview words it ("<name> <low>-<high> °C"), split back up. */
function rowParts(row: string): { name: string; range: string } {
  const match = /^(.*) (\d+)-(\d+) °C$/.exec(row);
  if (!match) return { name: row, range: "" };
  return { name: match[1] ?? "", range: formatRange(Number(match[2]), Number(match[3])) };
}

/** What an update changes in SpoolEase's row, saying only what differs. */
function updateText(listed: string, becomes: string): string {
  const from = rowParts(listed);
  const to = rowParts(becomes);
  const renamed = from.name !== to.name;
  const ranged = from.range !== to.range;
  if (renamed && ranged)
    return `SpoolEase lists it as ${from.name} at ${from.range}; the run changes that to ${to.name} at ${to.range}`;
  if (renamed) return `SpoolEase lists it as ${from.name}; the run changes that to ${to.name}`;
  if (ranged) return `SpoolEase lists it at ${from.range}; the run changes that to ${to.range}`;
  // Name and range agree: what differs is the material, which these words don't show.
  return "SpoolEase lists it with another material; the run changes that";
}

/** What the plan's words mean where it matters: each edit and update, and counts of kept presets and existing spools. */
export function planNotes(
  profiles: FilamentProfile[],
  plans: ProfilePlan[],
  overwrite: boolean,
  edits: ReadonlyMap<string, Edits>,
  changes: ReadonlyMap<string, EditChange[]> = new Map(),
): Note[] {
  const notes: Note[] = [];
  plans.forEach((plan, index) => {
    const profile = profiles[index];
    const count = profile ? (edits.get(profile.filamentId)?.size ?? 0) : 0;
    if (profile && count > 0)
      notes.push(editNote(profile, plan, overwrite, count, changes.get(profile.filamentId)));
  });
  plans.forEach((plan, index) => {
    const profile = profiles[index];
    if (profile && plan.filament?.state === "update")
      notes.push({
        text: `↻ ${profile.name}: ${updateText(plan.filament.listed, plan.filament.becomes)}`,
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

export interface RunCounts {
  /** Filaments the run wrote something for: a preset or SpoolEase. */
  written: number;
  /** Filaments it left as they were: every preset kept, SpoolEase skipped or there already. */
  skipped: number;
  failed: number;
}

export function runCounts(results: SyncResult[]): RunCounts {
  const failed = results.filter(resultFailed).length;
  const written = results.filter(
    (r) => !resultFailed(r) && (r.bambuStatus === "written" || r.spooleaseStatus === "written"),
  ).length;
  return { written, skipped: results.length - failed - written, failed };
}

/** Whether the run wrote any BambuStudio preset: BambuStudio shows them only after a restart. */
export function wrotePresets(results: SyncResult[]): boolean {
  return results.some((r) => r.bambuStatus === "written");
}

/** SpoolEase's side of a failure as sync words it (sync.ts), in plain words; the reason in brackets. */
const SPOOLEASE_FAILURES: [RegExp, string][] = [
  [
    /^custom filaments CSV: reading current list failed: (.*)$/s,
    "SpoolEase's custom filament list couldn't be read, so nothing was sent",
  ],
  [/^custom filaments CSV: (.*)$/s, "SpoolEase refused the custom filament list"],
  [
    /^registered \S+; listing spools failed: (.*)$/s,
    "SpoolEase listed it but its spools couldn't be read, so no spool was made",
  ],
  [/^registered \S+; spool rejected: (.*)$/s, "SpoolEase listed it but refused its spool"],
  [
    /^registered \S+; spool request error: (.*)$/s,
    "SpoolEase listed it but its spool couldn't be sent",
  ],
];

/** A failed filament by its name, what went wrong in plain words: no codes, the reason in brackets. */
export function failureText(result: SyncResult): string {
  let rest = result.detail;
  const parts: string[] = [];
  const preset = /^BambuStudio preset: (.*?)(?:; (.*))?$/s.exec(rest);
  if (preset) {
    if (result.bambuStatus === "failed")
      parts.push(`BambuStudio's preset couldn't be written (${preset[1]})`);
    rest = preset[2] ?? "";
  } else if (rest.startsWith("BambuStudio preset exists")) rest = rest.replace(/^[^;]*;\s*/, "");
  if (result.spooleaseStatus === "failed") {
    const known = SPOOLEASE_FAILURES.map(([pattern, words]) => {
      const match = pattern.exec(rest);
      return match ? `${words} (${match[1]})` : null;
    }).find(Boolean);
    parts.push(known ?? rest);
  }
  return `${result.profileName}: ${parts.filter(Boolean).join("; ") || result.detail}`;
}

/** What a finished run tells the session (summary, exit code), the footer (toast) and the labels offer. */
export function runOutcome(results: SyncResult[], sourceLabel: string): RunOutcome {
  const failed = results.filter(resultFailed);
  const counts = runCounts(results);
  const spoolIds = results.map((r) => r.spoolId).filter((id): id is string => Boolean(id));
  const counted = [
    ...(counts.written > 0 || results.length === counts.written
      ? [`${counts.written} written`]
      : []),
    ...(counts.skipped > 0 ? [`${counts.skipped} skipped`] : []),
    ...(counts.failed > 0 ? [`${counts.failed} failed`] : []),
    ...(spoolIds.length > 0 ? [plural(spoolIds.length, "new spool")] : []),
  ];
  const lines = [
    `${plural(results.length, "filament")} from ${sourceLabel}: ${counted.join(", ")}`,
    ...failed.map(failureText),
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
  const text =
    counts.written > 0 || results.length === 0
      ? `${plural(counts.written, "filament")} added${added}`
      : `${plural(counts.skipped, "filament")} there already`;
  return { summary: { ok: true, lines }, toast: { text, tone: "ok" }, spoolIds };
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
  temps: "Range",
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
  /** SpoolEase's plan words are drawn joined ("add+spool") to leave the names their room. */
  joined: boolean;
}

/** A status's words without the spaces around "+", for a narrow table: "add+spool". */
export function joinWords(text: string): string {
  return text.replaceAll(" + ", "+");
}

/** Below this the name would be cut before anything else gave way. */
const NAME_MIN = 14;
/** At most this wide, so a long brand or material doesn't take the name's room. */
const BRAND_MAX = 14;
const MATERIAL_MAX = 10;

/**
 * The plan table's columns fitted to `width` (the list's width), sized from the rows' own values.
 * A brand or material all rows share moves to the title; names leave out what a column or the title
 * says. When the name would be cut, the code goes first, then the empty weight; when it would be cut
 * below NAME_MIN, the brand and material columns too (the names then say them); past that the status
 * columns and temperatures shrink.
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
  let joined = false;
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
  // The name is what tells rows apart: the code and the empty weight give way before any of it is cut.
  for (const drop of ["code", "empty"] as const) {
    if (fixed() + nameWant() <= room) break;
    shown[drop] = 0;
  }
  // Before a run the status columns needn't keep room for the run's words: the run sizes them again.
  if (fixed() + nameWant() > room && rows.every((r) => r.preset.kind === "plan")) {
    shown.preset = span(
      COLUMN_TITLES.preset,
      rows.map((r) => statusLabel(r.preset)),
    );
    if (shown.spool > 0)
      shown.spool = span(
        COLUMN_TITLES.spool,
        rows.map((r) => statusLabel(r.spool)),
      );
    // Still short: SpoolEase's words join up ("add+spool"), a column or two for the names.
    if (fixed() + nameWant() > room && shown.spool > 0) {
      joined = true;
      shown.spool = span(
        COLUMN_TITLES.spool,
        rows.map((r) => joinWords(statusLabel(r.spool))),
      );
    }
  }
  // Brand and material columns go too when that makes every name whole (the names then say them).
  if (fixed() + nameWant() > room && (shown.brand > 0 || shown.material > 0)) {
    const kept = { brand: shown.brand, material: shown.material, stripBrand, stripMaterial };
    if (shown.brand > 0) [shown.brand, stripBrand] = [0, false];
    if (shown.material > 0) [shown.material, stripMaterial] = [0, false];
    if (fixed() + nameWant() > room)
      ({ brand: shown.brand, material: shown.material, stripBrand, stripMaterial } = kept);
  }
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
  return { widths, brand, material, stripBrand, stripMaterial, joined };
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
