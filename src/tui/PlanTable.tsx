// ABOUTME: Per-profile table showing color swatches, plan details, and live sync status.
// ABOUTME: Used for both the pre-apply plan and the progress/summary views.

import { Badge, ProgressBar, Spinner } from "@inkjs/ui";
import { Box, Text } from "ink";

import type { FilamentProfile, Status } from "../models.js";
import type { ProfilePlan } from "../planPreview.js";
import type { Edits } from "../presetEdit.js";
import { fitColumns } from "./screenSize.js";
import { COLORS } from "./theme.js";

// The swatch shows the color, so the table leaves its RGBA out and keeps the width for what the run does.
const COLUMNS = {
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

type Column = keyof typeof COLUMNS;

// On a narrow terminal the name gives up columns first, down to this, then the brand. Below that the
// status columns give way down to a whole badge (" SKIPPED " plus a gap, so the header fits too), then
// material and temperatures, then name and brand again. Code and empty weight never shrink: the code
// is the ID that links preset, CSV and spool. Past every minimum the rows are clipped (see PlanTable).
const SHRINK: readonly (readonly [Column, number])[] = [
  ["name", 10],
  ["brand", 5],
  ["spool", 10],
  ["preset", 10],
  ["material", 6],
  ["temps", 8],
  ["name", 6],
  ["brand", 4],
];

type Tone = "new" | "same" | "change";

const TONE_COLORS: Record<Tone, { color?: string; dim?: boolean }> = {
  new: { color: "green" },
  same: { dim: true },
  change: { color: "yellow" },
};

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

function PlanCell({ plan }: { plan: { text: string; tone: Tone } | null }) {
  if (!plan) return <Text dimColor>·</Text>;
  const { color, dim } = TONE_COLORS[plan.tone];
  return (
    <Text {...(color ? { color } : {})} {...(dim ? { dimColor: dim } : {})} wrap="truncate-end">
      {plan.text}
    </Text>
  );
}

export interface RowProgress {
  preset?: Status;
  spool?: Status;
}

const STATUS_COLORS: Record<Status, string> = {
  written: COLORS.ok,
  failed: COLORS.failed,
  planned: COLORS.warning,
  skipped: COLORS.muted,
};

function StatusCell({ status, active }: { status: Status | undefined; active: boolean }) {
  if (status) return <Badge color={STATUS_COLORS[status]}>{status}</Badge>;
  if (active) return <Spinner type="dots" label="working" />;
  return <Text dimColor>·</Text>;
}

/** Profiles the run is done with: both their preset and their SpoolEase status are in. */
export function finishedProfiles(progress: RowProgress[]): number {
  return progress.filter((row) => row.preset && row.spool).length;
}

const PROGRESS_WIDTH = 30;

/**
 * How far the run is, 0 to 100: each profile is two steps, its preset and its SpoolEase status, since
 * every preset is written before any spool and counting whole profiles would leave the bar empty meanwhile.
 */
export function runPercent(progress: RowProgress[], total: number): number {
  if (total <= 0) return 0;
  const steps = progress.reduce((sum, row) => sum + (row.preset ? 1 : 0) + (row.spool ? 1 : 0), 0);
  return (steps / (2 * total)) * 100;
}

/** A bar of how far the run is, with the profiles finished out of its total beside it. */
export function RunProgress({ progress, total }: { progress: RowProgress[]; total: number }) {
  const finished = finishedProfiles(progress);
  return (
    <Box gap={1}>
      <Box width={PROGRESS_WIDTH} flexShrink={0}>
        <ProgressBar value={runPercent(progress, total)} />
      </Box>
      <Text wrap="truncate-end">
        {finished}/{total} profiles finished
      </Text>
    </Box>
  );
}

/**
 * A column cell: truncated to its width, keeping one blank column before the next cell.
 * Widths come from fitColumns in whole columns, so no cell shrinks (a cell laid out a fraction
 * narrower draws its text over the gap).
 */
function Cell({ width, children, dim }: { width: number; children: string; dim?: boolean }) {
  return (
    <Box width={width} paddingRight={1} flexShrink={0}>
      <Text wrap="truncate-end" {...(dim ? { dimColor: dim } : {})}>
        {children}
      </Text>
    </Box>
  );
}

interface Props {
  profiles: FilamentProfile[];
  progress: RowProgress[];
  /** What the run would do, shown until it reports (its nozzle ranges all along); null or absent when it couldn't be worked out. */
  plans?: ProfilePlan[] | null;
  overwrite?: boolean;
  activePresets: boolean;
  activeSpools: boolean;
  /** The terminal's width, to fit the table into; undefined keeps every column whole. */
  columns?: number | undefined;
}

export function PlanTable({
  profiles,
  progress,
  plans,
  overwrite = false,
  activePresets,
  activeSpools,
  columns,
}: Props) {
  const width = fitColumns(COLUMNS, columns, SHRINK);
  // Once a run starts, every row shows its live status instead of the plan.
  const started = activePresets || activeSpools || progress.length > 0;
  // Rows wider than the terminal would wrap and throw off Ink's redraws, so past every minimum they're clipped.
  return (
    <Box
      flexDirection="column"
      {...(columns ? { width: columns, overflowX: "hidden" as const } : {})}
    >
      <Box>
        <Cell width={width.swatch} dim>
          {""}
        </Cell>
        <Cell width={width.name} dim>
          Name
        </Cell>
        <Cell width={width.brand} dim>
          Brand
        </Cell>
        <Cell width={width.material} dim>
          Material
        </Cell>
        <Cell width={width.temps} dim>
          Nozzle°C
        </Cell>
        <Cell width={width.code} dim>
          Code
        </Cell>
        <Cell width={width.empty} dim>
          Empty
        </Cell>
        <Cell width={width.preset} dim>
          Preset
        </Cell>
        <Cell width={width.spool} dim>
          SpoolEase
        </Cell>
      </Box>
      {profiles.map((profile, index) => {
        const row = progress[index] ?? {};
        const plan = started ? undefined : plans?.[index];
        const range = plans?.[index]?.nozzleRange ?? {
          low: profile.nozzleTempMin,
          high: profile.nozzleTempMax,
        };
        return (
          <Box
            // biome-ignore lint/suspicious/noArrayIndexKey: profiles aren't deduplicated (a JSON source can repeat a name or filament ID), so the row's position is part of its identity; the list never reorders while shown.
            key={`${index}-${profile.name}`}
          >
            <Box width={width.swatch} flexShrink={0}>
              <Text backgroundColor={`#${profile.colorRgba.slice(0, 6)}`}>{"  "}</Text>
            </Box>
            <Cell width={width.name}>{profile.name}</Cell>
            <Cell width={width.brand}>{profile.brand}</Cell>
            <Cell width={width.material}>{profile.material}</Cell>
            <Cell width={width.temps}>{`${range.low}-${range.high}`}</Cell>
            <Cell width={width.code}>{profile.filamentId}</Cell>
            <Cell width={width.empty}>{profile.coreWeight ? `${profile.coreWeight} g` : "–"}</Cell>
            <Box width={width.preset} paddingRight={1} flexShrink={0}>
              {plan ? (
                <PlanCell plan={presetPlanText(plan, overwrite)} />
              ) : (
                <StatusCell status={row.preset} active={activePresets} />
              )}
            </Box>
            <Box width={width.spool} flexShrink={0}>
              {plan ? (
                <PlanCell plan={spoolEasePlanText(plan)} />
              ) : (
                <StatusCell status={row.spool} active={activeSpools} />
              )}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
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
): { text: string; tone: "yellow" | "red" } {
  const written = overwrite ? plan.presets : plan.presets - plan.existingPresets;
  const changes = plural(count, "change");
  if (written === 0)
    return {
      text: `✎ ${profile.filamentId}: the run keeps its presets, so its ${changes} ${count === 1 ? "goes" : "go"} nowhere`,
      tone: "red",
    };
  return {
    text: `✎ ${profile.filamentId}: ${changes} ${count === 1 ? "goes" : "go"} into the ${plural(written, "preset")} the run writes`,
    tone: "yellow",
  };
}

interface NotesProps {
  profiles: FilamentProfile[];
  plans: ProfilePlan[];
  overwrite: boolean;
  /** Edits made on the plan, by filament ID. */
  edits?: ReadonlyMap<string, Edits>;
}

/** What the plan's words mean where it matters: each update and edit, and counts of kept presets and existing spools. */
export function PlanNotes({ profiles, plans, overwrite, edits = new Map() }: NotesProps) {
  const updates = plans.flatMap((plan, index) => {
    const profile = profiles[index];
    return plan.filament?.state === "update" && profile
      ? [{ profile, filament: plan.filament }]
      : [];
  });
  const edited = plans.flatMap((plan, index) => {
    const profile = profiles[index];
    const count = profile ? (edits.get(profile.filamentId)?.size ?? 0) : 0;
    return profile && count > 0
      ? [{ key: profile.filamentId, ...editNote(profile, plan, overwrite, count) }]
      : [];
  });
  const kept = overwrite ? 0 : plans.reduce((sum, plan) => sum + plan.existingPresets, 0);
  const spooled = plans.filter((plan) => plan.spool === "exists").length;
  if (updates.length === 0 && edited.length === 0 && kept === 0 && spooled === 0) return null;
  return (
    <Box flexDirection="column">
      {edited.map((note) => (
        <Text key={note.key} color={note.tone} wrap="truncate-end">
          {note.text}
        </Text>
      ))}
      {updates.map(({ profile, filament }) => (
        <Text key={profile.filamentId} color="yellow" wrap="truncate-end">
          ↻ {profile.filamentId} is {filament.listed} on SpoolEase; the run changes it to{" "}
          {filament.becomes}
        </Text>
      ))}
      {kept > 0 ? (
        <Text dimColor wrap="truncate-end">
          = kept: {plural(kept, "preset")} {kept === 1 ? "is" : "are"} there already and{" "}
          {kept === 1 ? "stays as it is" : "stay as they are"} (Overwrite presets in Settings
          replaces {kept === 1 ? "it" : "them"})
        </Text>
      ) : null}
      {spooled > 0 ? (
        <Text dimColor wrap="truncate-end">
          has spool: the console has a spool of {plural(spooled, "filament")} already, so{" "}
          {spooled === 1 ? "it gets" : "they get"} no new one
        </Text>
      ) : null}
    </Box>
  );
}
