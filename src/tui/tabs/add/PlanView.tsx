// ABOUTME: The Review and Run/Done pages: a card naming every target (or the run's progress, or its outcome) over the plan table.
// ABOUTME: The table shows per row what the run would do, then live statuses; notes and warnings go under it.

import { Box } from "ink";

import type { Status } from "../../../models.js";
import type { Ctx } from "../../core/types.js";
import {
  Bar,
  Busy,
  Detail,
  type DetailRow,
  Line,
  List,
  type ListRow,
  listPosition,
  Panel,
  panelInner,
  type Segment,
} from "../../ui/index.js";
import { fitText } from "../../ui/text.js";
import { COLORS } from "../../ui/theme.js";
import { pageArea } from "./layout.js";
import type { AddModel } from "./model.js";
import {
  finishedProfiles,
  fitColumns,
  type Note,
  PLAN_COLUMNS,
  PLAN_SHRINK,
  type PlanColumn,
  type PlanRow,
  planNotes,
  planRows,
  runOutcome,
  runPercent,
  STAGE_LABELS,
  type StatusCell,
  type Tone,
} from "./plan.js";
import { runTargets } from "./targets.js";

type TableColumn = Exclude<PlanColumn, "swatch">;

const COLUMN_TITLES: Record<TableColumn, string> = {
  name: "Name",
  brand: "Brand",
  material: "Material",
  temps: "Nozzle",
  code: "Code",
  empty: "Empty",
  preset: "Preset",
  spool: "SpoolEase",
};

const TABLE_COLUMNS = Object.keys(COLUMN_TITLES) as TableColumn[];

/** The list's own columns before and after the cells: gutter, chip and its gap, scroll thumb. */
const LIST_EDGES = 5;

/** Each column's cell width in a table `width` columns wide (a column's width counts its gap). */
export function tableWidths(width: number): Record<TableColumn, number> {
  const { swatch: _swatch, ...columns } = PLAN_COLUMNS;
  const shrink = PLAN_SHRINK.filter(([key]) => key !== "swatch") as [TableColumn, number][];
  const fitted = fitColumns(columns, Math.max(0, width - LIST_EDGES + 1), shrink);
  return Object.fromEntries(
    TABLE_COLUMNS.map((key) => [key, Math.max(0, fitted[key] - 1)]),
  ) as Record<TableColumn, number>;
}

const TONE_COLORS: Record<Tone, { color: string; dim?: boolean }> = {
  new: { color: COLORS.ok },
  same: { color: COLORS.muted },
  change: { color: COLORS.warning },
};

const STATUS: Record<Status, { text: string; color: string }> = {
  written: { text: "✓ written", color: COLORS.ok },
  failed: { text: "✗ failed", color: COLORS.failed },
  skipped: { text: "- skipped", color: COLORS.muted },
  planned: { text: "! planned", color: COLORS.warning },
};

function statusText(cell: StatusCell): { text: string; color: string } {
  switch (cell.kind) {
    case "plan":
      return { text: cell.text, color: TONE_COLORS[cell.tone].color };
    case "status":
      return STATUS[cell.status];
    case "working":
      return { text: "… working", color: COLORS.accent };
    case "none":
      return { text: "·", color: COLORS.muted };
  }
}

export function tableRow(
  row: PlanRow,
  index: number,
  widths: Record<TableColumn, number>,
): ListRow {
  const preset = statusText(row.preset);
  const spool = statusText(row.spool);
  return {
    key: `${index}:${row.code}`,
    swatch: row.swatch,
    cells: [
      { text: row.name, width: widths.name },
      { text: row.brand, width: widths.brand },
      { text: row.material, width: widths.material },
      { text: row.temps, width: widths.temps },
      { text: row.code, width: widths.code, dim: true },
      { text: row.empty, width: widths.empty, align: "right" },
      { text: preset.text, width: widths.preset, color: preset.color },
      { text: spool.text, width: widths.spool, color: spool.color },
    ],
  };
}

function headerSegments(widths: Record<TableColumn, number>): Segment[] {
  const out: Segment[] = [{ text: "    " }];
  for (const key of TABLE_COLUMNS) {
    if (widths[key] <= 0) continue;
    out.push({
      text: `${fitText(COLUMN_TITLES[key], widths[key], key === "empty" ? "right" : "left")} `,
      color: COLORS.muted,
    });
  }
  return out;
}

const NOTE_COLORS: Record<Note["tone"], string> = {
  warning: COLORS.warning,
  failed: COLORS.failed,
  muted: COLORS.muted,
};

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The targets card: every place the run writes to. */
function targetRows(ctx: Ctx): DetailRow[] {
  const t = runTargets(ctx.values);
  const spoolease =
    t.console === "ready"
      ? {
          value: `${t.consoleUrl} · ${t.createSpools ? "filaments + new spools" : "filaments only"}`,
        }
      : t.console === "skipped"
        ? { value: "skipped", dim: true }
        : { value: "not set up: add the host and key in Settings", tone: "failed" as const };
  return [
    { label: "Presets", value: `${t.presetDir} · existing ${t.overwrite ? "replaced" : "kept"}` },
    {
      label: "Printers",
      value:
        t.printers.map((p) => p.replace(/^Bambu Lab /, "")).join(", ") ||
        "none: choose in Settings",
      ...(t.printers.length === 0 ? { tone: "failed" as const } : {}),
    },
    { label: "SpoolEase", ...spoolease },
  ];
}

function Card({ model, ctx, width }: { model: AddModel; ctx: Ctx; width: number }) {
  const inner = panelInner(width, 5);
  const { run, review } = model;
  const count = (run?.profiles ?? review.profiles).length;
  if (!run)
    return (
      <Panel
        title="Review"
        subtitle={`${plural(count, "filament")} · nothing written yet`}
        width={width}
        height={5}
      >
        <Detail rows={targetRows(ctx)} width={inner.width} />
      </Panel>
    );
  if (run.state === "running") {
    const finished = finishedProfiles(run.progress);
    const barWidth = Math.min(30, Math.max(10, inner.width - 24));
    return (
      <Panel
        title="Running"
        subtitle={`${finished} of ${plural(count, "filament")} done`}
        focused
        width={width}
        height={5}
      >
        <Box paddingLeft={1}>
          <Busy message={`${run.stage ? STAGE_LABELS[run.stage] : "Starting"}…`} />
        </Box>
        <Line width={inner.width} segments={[]} />
        <Box paddingLeft={1} flexDirection="row">
          <Bar fraction={runPercent(run.progress, count) / 100} width={barWidth} />
          <Line
            width={Math.max(0, inner.width - barWidth - 1)}
            segments={[
              { text: ` ${Math.round(runPercent(run.progress, count))}%`, color: COLORS.muted },
            ]}
          />
        </Box>
      </Panel>
    );
  }
  if (run.state === "failed")
    return (
      <Panel title="Failed" focused width={width} height={5}>
        <Line
          width={inner.width}
          segments={[{ text: ` ✗ ${run.error}`, color: COLORS.failed, bold: true }]}
        />
        <Line width={inner.width} segments={[]} />
        <Line
          width={inner.width}
          segments={[
            {
              text: " Your selection is kept: fix the cause and apply again.",
              color: COLORS.muted,
            },
          ]}
        />
      </Panel>
    );
  const outcome = runOutcome(run.results, run.sourceLabel);
  const failed = run.results.filter(
    (r) => r.bambuStatus === "failed" || r.spooleaseStatus === "failed",
  ).length;
  return (
    <Panel title="Done" subtitle={run.sourceLabel} focused width={width} height={5}>
      <Line
        width={inner.width}
        segments={[
          {
            text: ` ${failed ? "✗" : "✓"} ${run.results.length - failed} written, ${failed} failed`,
            color: failed ? COLORS.failed : COLORS.ok,
            bold: true,
          },
          ...(run.spoolIds.length > 0
            ? [{ text: ` · ${plural(run.spoolIds.length, "new spool")}`, color: COLORS.ok }]
            : []),
        ]}
      />
      <Line
        width={inner.width}
        segments={[
          {
            text: failed
              ? ` ${outcome.summary.lines.slice(1).join(" · ")}`
              : " Restart BambuStudio to see the new presets.",
            color: failed ? COLORS.failed : COLORS.muted,
          },
        ]}
      />
      <Line
        width={inner.width}
        segments={
          run.spoolIds.length > 0
            ? [
                { text: " l", color: COLORS.accent2, bold: true },
                { text: " labels for the new spools  ", color: COLORS.muted },
                { text: "n", color: COLORS.accent2, bold: true },
                { text: " add more", color: COLORS.muted },
              ]
            : [
                { text: " n", color: COLORS.accent2, bold: true },
                { text: " add more", color: COLORS.muted },
              ]
        }
      />
    </Panel>
  );
}

/** The lines under the table: what the plan's words mean, warnings, and why apply refused. */
export function planFooterLines(model: AddModel, ctx: Ctx): Segment[][] {
  const { run, review } = model;
  const lines: Segment[][] = [];
  if (!run && review.state === "ready" && review.plans) {
    for (const note of planNotes(
      review.profiles,
      review.plans,
      ctx.values.overwritePresets,
      model.planEdits,
    ))
      lines.push([{ text: ` ${note.text}`, color: NOTE_COLORS[note.tone] }]);
  }
  for (const warning of run ? run.warnings : review.warnings)
    lines.push([{ text: ` ! ${warning}`, color: COLORS.warning }]);
  if (!run && review.error) lines.push([{ text: ` ✗ ${review.error}`, color: COLORS.failed }]);
  return lines;
}

export function PlanView({ model, ctx }: { model: AddModel; ctx: Ctx }) {
  const area = pageArea(ctx.bodyColumns, ctx.bodyRows);
  const { run, review } = model;
  const profiles = run?.profiles ?? review.profiles;
  const plans = run?.plans ?? review.plans;
  const rows = planRows(
    profiles,
    plans,
    run?.progress ?? [],
    run?.stage ?? null,
    ctx.values.overwritePresets,
  );
  const footer = planFooterLines(model, ctx).slice(0, Math.max(0, area.height - 5 - 4));
  const tableHeight = Math.max(4, area.height - 5 - footer.length);
  const inner = panelInner(area.width, tableHeight);
  const widths = tableWidths(inner.width);
  const loading = !run && review.state !== "ready";
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Card model={model} ctx={ctx} width={area.width} />
      <Panel
        title="Plan"
        subtitle={run ? "what the run did" : "what applying does"}
        focused={!run}
        width={area.width}
        height={tableHeight}
        footerRight={listPosition(review.cursor, rows.length)}
      >
        <Line width={inner.width} segments={headerSegments(widths)} />
        {loading ? (
          <Box paddingLeft={1}>
            <Busy message="Comparing with what BambuStudio and SpoolEase have…" />
          </Box>
        ) : (
          <List
            rows={rows.map((row, index) => tableRow(row, index, widths))}
            cursor={Math.min(review.cursor, Math.max(0, rows.length - 1))}
            height={Math.max(0, inner.height - 1)}
            width={inner.width}
            focused={!run}
          />
        )}
      </Panel>
      {footer.map((segments, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional lines under the table.
        <Line key={index} width={area.width} segments={segments} />
      ))}
    </Box>
  );
}
