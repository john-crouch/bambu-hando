// ABOUTME: The Review and Run/Done pages: a card naming every target (or the run's progress, or its outcome) over the plan table.
// ABOUTME: The table shows per row what the run would do, then live statuses; notes and warnings go under it.

import { Box } from "ink";

import type { Status } from "../../../models.js";
import type { Ctx } from "../../core/types.js";
import { plural, shortPrinter } from "../../ui/format.js";
import {
  Bar,
  Busy,
  type Cell,
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
import { fitText, textWidth, truncate } from "../../ui/text.js";
import { COLORS } from "../../ui/theme.js";
import { pageArea } from "./layout.js";
import type { AddModel } from "./model.js";
import {
  COLUMN_TITLES,
  finishedProfiles,
  type Note,
  type PlanLayout,
  type PlanRow,
  planLayout,
  planNotes,
  planRows,
  runOutcome,
  runPercent,
  STAGE_LABELS,
  type StatusCell,
  shortName,
  statusLabel,
  TABLE_COLUMNS,
  type Tone,
} from "./plan.js";
import { runTargets } from "./targets.js";
import { nothingToApply } from "./update.js";
import { wrapText } from "./wrap.js";

const TONE_COLORS: Record<Tone, { color: string; dim?: boolean }> = {
  new: { color: COLORS.ok },
  same: { color: COLORS.muted },
  change: { color: COLORS.warning },
};

const STATUS_COLORS: Record<Status, string> = {
  written: COLORS.ok,
  failed: COLORS.failed,
  skipped: COLORS.muted,
  planned: COLORS.warning,
};

function statusColor(cell: StatusCell): string {
  switch (cell.kind) {
    case "plan":
      return TONE_COLORS[cell.tone].color;
    case "status":
      return STATUS_COLORS[cell.status];
    case "working":
      return COLORS.accent;
    case "none":
      return COLORS.muted;
  }
}

function statusText(cell: StatusCell): { text: string; color: string } {
  return { text: statusLabel(cell), color: statusColor(cell) };
}

export function tableRow(row: PlanRow, index: number, layout: PlanLayout): ListRow {
  const { widths } = layout;
  const preset = statusText(row.preset);
  const spool = statusText(row.spool);
  const name = shortName(
    row.name,
    row.brand,
    row.material,
    layout.stripBrand,
    layout.stripMaterial,
  );
  return {
    key: `${index}:${row.code}`,
    swatch: row.swatch,
    // Columns a narrow table drops have no width: leave their cells out, gaps and all.
    cells: (
      [
        { text: `${row.edited ? "✎ " : ""}${name}`, width: widths.name },
        { text: row.brand, width: widths.brand },
        { text: row.material, width: widths.material },
        { text: row.temps, width: widths.temps },
        { text: row.code, width: widths.code, dim: true },
        { text: row.empty, width: widths.empty, align: "right" },
        { text: preset.text, width: widths.preset, color: preset.color },
        { text: spool.text, width: widths.spool, color: spool.color },
      ] satisfies Cell[]
    ).filter((cell) => cell.width > 0),
  };
}

function headerSegments(widths: PlanLayout["widths"]): Segment[] {
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

/** A path cut from the middle so its end (the folder it is) stays: "~/.config/…/filament/base". */
export function fitPath(path: string, width: number): string {
  if (textWidth(path) <= width) return path;
  const parts = path.split("/");
  for (let keep = parts.length - 1; keep > 0; keep--) {
    const tail = parts.slice(parts.length - keep).join("/");
    const cut = `${parts[0]}/…/${tail}`;
    if (textWidth(cut) <= width) return cut;
  }
  return truncate(path, width);
}

/** The targets card's label column and its gap, as Detail draws it. */
const TARGET_LABEL = 11;

/** The targets card: every place the run writes to. */
function targetRows(ctx: Ctx, width: number): DetailRow[] {
  const t = runTargets(ctx.values);
  const spoolease =
    t.console === "ready"
      ? {
          value: `${t.consoleUrl} · ${t.createSpools ? "filaments + new spools" : "filaments only"}`,
        }
      : t.console === "skipped"
        ? { value: "skipped", dim: true }
        : { value: "not set up: add the host and key in Settings (s)", tone: "failed" as const };
  return [
    {
      label: "Presets",
      value: `${fitPath(t.presetDir, Math.max(8, width - TARGET_LABEL - 18))} · existing ${t.overwrite ? "replaced" : "kept"}`,
    },
    {
      label: "Printers",
      value: t.printers.map(shortPrinter).join(", ") || "none: choose in Settings (s)",
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
        <Detail rows={targetRows(ctx, inner.width)} width={inner.width} />
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
  // The next keys are the footer's: the card says what happened, once.
  const outcome = runOutcome(run.results, run.sourceLabel);
  const failed = run.results.filter(
    (r) => r.bambuStatus === "failed" || r.spooleaseStatus === "failed",
  ).length;
  const written = run.results.length - failed;
  const prose = failed
    ? outcome.summary.lines.slice(1).join(" · ")
    : "Restart BambuStudio to see the new presets.";
  return (
    <Panel title="Done" subtitle={run.sourceLabel} focused width={width} height={5}>
      <Line
        width={inner.width}
        segments={[
          ...(written > 0 || failed === 0
            ? [{ text: ` ✓ ${written} written`, color: COLORS.ok, bold: true }]
            : []),
          ...(failed > 0
            ? [{ text: ` ✗ ${failed} failed`, color: COLORS.failed, bold: true }]
            : []),
          ...(run.spoolIds.length > 0
            ? [{ text: ` · ${plural(run.spoolIds.length, "new spool")}`, color: COLORS.ok }]
            : []),
        ]}
      />
      {wrapText(prose, Math.max(0, inner.width - 1), 2).map((line) => (
        <Line
          key={line}
          width={inner.width}
          segments={[{ text: ` ${line}`, color: failed ? COLORS.failed : COLORS.muted }]}
        />
      ))}
    </Panel>
  );
}

/** A note wrapped to the width, its lines after the first indented under its text. */
function noteLines(text: string, color: string, width: number, mark = ""): Segment[][] {
  const lead = mark ? `${mark} ` : "";
  return wrapText(text, Math.max(1, width - 1 - textWidth(lead))).map((line, index) => [
    { text: ` ${index === 0 ? lead : " ".repeat(textWidth(lead))}${line}`, color },
  ]);
}

/** The lines under the table, wrapped: what the plan's words mean, warnings, and why apply refused. */
export function planFooterLines(model: AddModel, ctx: Ctx, width: number): Segment[][] {
  const { run, review } = model;
  const lines: Segment[][] = [];
  if (!run && review.state === "ready" && review.plans) {
    if (nothingToApply(model, ctx))
      lines.push(
        ...noteLines(
          "Nothing to apply: every preset, custom filament and spool is there already.",
          COLORS.ok,
          width,
          "✓",
        ),
      );
    for (const note of planNotes(
      review.profiles,
      review.plans,
      ctx.values.overwritePresets,
      model.planEdits,
      model.planChanges,
    ))
      lines.push(...noteLines(note.text, NOTE_COLORS[note.tone], width));
  }
  for (const warning of run ? run.warnings : review.warnings)
    lines.push(...noteLines(warning, COLORS.warning, width, "!"));
  if (!run && review.error) {
    const fix = /Settings/.test(review.error) ? "" : " (s fixes it in Settings)";
    lines.push(...noteLines(`${review.error}${fix}`, COLORS.failed, width, "✗"));
  }
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
  ).map((row) => (!run && model.planEdits.has(row.code) ? { ...row, edited: true } : row));
  const footer = planFooterLines(model, ctx, area.width).slice(0, Math.max(0, area.height - 5 - 4));
  const tableHeight = Math.max(4, area.height - 5 - footer.length);
  const inner = panelInner(area.width, tableHeight);
  const layout = planLayout(rows, inner.width);
  const shared = [layout.brand, layout.material].filter(Boolean).join(" ");
  const what = run ? "what the run did" : "what applying does";
  const loading = !run && review.state !== "ready";
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Card model={model} ctx={ctx} width={area.width} />
      <Panel
        title="Plan"
        subtitle={shared ? `${shared} · ${what}` : what}
        focused={!run}
        width={area.width}
        height={tableHeight}
        footerRight={listPosition(review.cursor, rows.length)}
      >
        <Line width={inner.width} segments={headerSegments(layout.widths)} />
        {loading ? (
          <Box paddingLeft={1}>
            <Busy message="Comparing with what BambuStudio and SpoolEase have…" />
          </Box>
        ) : (
          <List
            rows={rows.map((row, index) => tableRow(row, index, layout))}
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
