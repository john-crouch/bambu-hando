// ABOUTME: Per-profile table showing color swatches, plan details, and live sync status.
// ABOUTME: Used for both the pre-apply plan and the progress/summary views.

import { Box, Text } from "ink";
import Spinner from "ink-spinner";

import type { FilamentProfile, Status } from "../models.js";
import type { ProfilePlan } from "../planPreview.js";
import type { Edits } from "../presetEdit.js";

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
    <Text color={color} dimColor={dim} wrap="truncate-end">
      {plan.text}
    </Text>
  );
}

export interface RowProgress {
  preset?: Status;
  spool?: Status;
}

function StatusCell({ status, active }: { status: Status | undefined; active: boolean }) {
  if (status === "written") return <Text color="green">✓ written</Text>;
  if (status === "failed") return <Text color="red">✗ failed</Text>;
  if (status === "planned") return <Text color="yellow">○ planned</Text>;
  if (status === "skipped") return <Text dimColor>– skipped</Text>;
  if (active) {
    return (
      <Text color="cyan">
        <Spinner type="dots" /> working
      </Text>
    );
  }
  return <Text dimColor>·</Text>;
}

/** A column cell: truncated to its width, keeping one blank column before the next cell. */
function Cell({ width, children, dim }: { width: number; children: string; dim?: boolean }) {
  return (
    <Box width={width} paddingRight={1}>
      <Text wrap="truncate-end" dimColor={dim}>
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
}

export function PlanTable({
  profiles,
  progress,
  plans,
  overwrite = false,
  activePresets,
  activeSpools,
}: Props) {
  // Once a run starts, every row shows its live status instead of the plan.
  const started = activePresets || activeSpools || progress.length > 0;
  return (
    <Box flexDirection="column">
      <Box>
        <Cell width={COLUMNS.swatch} dim>
          {""}
        </Cell>
        <Cell width={COLUMNS.name} dim>
          Name
        </Cell>
        <Cell width={COLUMNS.brand} dim>
          Brand
        </Cell>
        <Cell width={COLUMNS.material} dim>
          Material
        </Cell>
        <Cell width={COLUMNS.temps} dim>
          Nozzle°C
        </Cell>
        <Cell width={COLUMNS.code} dim>
          Code
        </Cell>
        <Cell width={COLUMNS.empty} dim>
          Empty
        </Cell>
        <Cell width={COLUMNS.preset} dim>
          Preset
        </Cell>
        <Cell width={COLUMNS.spool} dim>
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
          <Box key={`${index}-${profile.name}`}>
            <Box width={COLUMNS.swatch}>
              <Text backgroundColor={`#${profile.colorRgba.slice(0, 6)}`}>{"  "}</Text>
            </Box>
            <Cell width={COLUMNS.name}>{profile.name}</Cell>
            <Cell width={COLUMNS.brand}>{profile.brand}</Cell>
            <Cell width={COLUMNS.material}>{profile.material}</Cell>
            <Cell width={COLUMNS.temps}>{`${range.low}-${range.high}`}</Cell>
            <Cell width={COLUMNS.code}>{profile.filamentId}</Cell>
            <Cell width={COLUMNS.empty}>
              {profile.coreWeight ? `${profile.coreWeight} g` : "–"}
            </Cell>
            <Box width={COLUMNS.preset} paddingRight={1}>
              {plan ? (
                <PlanCell plan={presetPlanText(plan, overwrite)} />
              ) : (
                <StatusCell status={row.preset} active={activePresets} />
              )}
            </Box>
            <Box width={COLUMNS.spool}>
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
