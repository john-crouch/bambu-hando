// ABOUTME: Importing your 3DFilamentProfiles spools, drawn: the list with what importing the highlighted spool writes on
// ABOUTME: Find, and the Review and Run/Done pages (targets card, a row per spool, the highlighted row's details under it).

import { Box } from "ink";

import { bambuBaseFilamentDir, tildePath } from "../../../paths.js";
import type { ImportItem } from "../../../tdfpImport.js";
import type { ImportPreviewRow } from "../../../tdfpImportSession.js";
import { importSettingsText, settingsParts } from "../../../tdfpImportSession.js";
import type { Ctx } from "../../core/types.js";
import { centered } from "../../ui/Empty.js";
import { fitPath, formatGrams, formatRange, plural, shortPrinter } from "../../ui/format.js";
import {
  Busy,
  type Cell,
  Detail,
  type DetailRow,
  Empty,
  Line,
  List,
  type ListRow,
  listPosition,
  Panel,
  panelInner,
  type Segment,
  Swatch,
} from "../../ui/index.js";
import { swatchSegments } from "../../ui/Swatch.js";
import { fitText, textWidth } from "../../ui/text.js";
import { COLORS } from "../../ui/theme.js";
import { consoleProblem } from "../settings/connection.js";
import { type Box as Area, pageArea, splitPage } from "./layout.js";
import type { AddModel } from "./model.js";
import { presetPlanText, STAGE_LABELS } from "./plan.js";
import { consoleOf, consoleUrl, printersOf } from "./targets.js";
import {
  importError,
  listRow,
  listRows,
  newSpoolIds,
  type ReviewRow,
  reviewRows,
  spoolName,
  spoolSwatch,
  type TdfpRunModel,
} from "./tdfp.js";
import { consoleKey } from "./tdfpCmds.js";
import { wrapText } from "./wrap.js";

const muted = (text: string): Segment => ({ text, color: COLORS.muted });

const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** Lines wrapped a column in from each side, each its own segment list; lead marks the first (later ones indent under it). */
function wrapped(text: string, width: number, color?: string, lead = ""): Segment[][] {
  const room = Math.max(1, width - 2 - textWidth(lead));
  return wrapText(text, room).map((line, index) => [
    {
      text: ` ${index === 0 ? lead : " ".repeat(textWidth(lead))}${line}`,
      ...(color ? { color } : {}),
    },
  ]);
}

function Lines({ lines, width }: { lines: Segment[][]; width: number }) {
  return (
    <>
      {lines.map((segments, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional lines.
        <Line key={index} width={width} segments={segments} />
      ))}
    </>
  );
}

// ── Find: the list ──────────────────────────────────────────────────────────

function listCells(row: ImportPreviewRow, ticked: boolean): Cell[] {
  const refused = row.refusal !== null;
  return [
    refused
      ? { text: " ✗ ", width: 3, color: COLORS.muted }
      : ticked
        ? { text: "[✓]", width: 3, color: COLORS.ok }
        : { text: "[ ]", width: 3, color: COLORS.muted },
    { text: spoolName(row.spool), grow: true, ...(refused ? { dim: true } : {}) },
    { text: formatGrams(row.spool.remainingGrams), width: 7, align: "right", dim: true },
  ];
}

function tdfpListRow(row: ImportPreviewRow, selected: ReadonlySet<string>): ListRow {
  return {
    key: row.spool.shortCode,
    swatch: spoolSwatch(row.spool),
    cells: listCells(row, selected.has(row.spool.shortCode)),
  };
}

/** What fills the page when there's no list to show: no console, loading, failed, or nothing to import. */
function ListState({ model, ctx, box }: { model: AddModel; ctx: Ctx; box: Area }) {
  const room = Math.max(1, box.width - 4);
  const wrap = (lines: string[]) => lines.flatMap((line) => wrapText(line, room));
  const empty = (title: string, lines: string[], action?: { keys: string; label: string }) => (
    <Empty
      title={title}
      lines={wrap(lines)}
      {...(action ? { action } : {})}
      width={box.width}
      height={box.height}
    />
  );
  if (!consoleKey(ctx.values))
    return empty(
      ctx.values.skipSpoolease ? "Use SpoolEase is off" : "SpoolEase isn't set up",
      ["Importing makes a SpoolEase spool for each 3DFP spool and links the two."],
      { keys: "enter", label: "open Settings › SpoolEase" },
    );
  const { list } = model.tdfp;
  if (list.state === "failed") {
    if (list.problem === "noKey")
      return empty(
        /^no /i.test(list.error)
          ? "No 3DFilamentProfiles API key"
          : "Can't read the 3DFilamentProfiles API key",
        // The title says there's none; the error's own words after it say how to give one.
        [sentence(list.error.replace(/^no [^:]*: /i, ""))],
        { keys: "r", label: "try again" },
      );
    if (list.problem === "spoolease")
      return empty("Couldn't read SpoolEase", [list.error, consoleProblem(list.error).advice], {
        keys: "s",
        label: "fix in Settings",
      });
    return empty("Couldn't read your 3DFilamentProfiles spools", [list.error], {
      keys: "r",
      label: "try again",
    });
  }
  if (list.state !== "ready")
    return (
      <Box paddingLeft={1}>
        <Busy message="Reading your 3DFilamentProfiles spools…" />
      </Box>
    );
  if (list.linked > 0)
    return empty("Every 3DFP spool is already linked", [
      `${plural(list.linked, "spool")} on 3DFilamentProfiles ${list.linked === 1 ? "is" : "are"} linked to this console's spools.`,
      "bambu-hando 3dfp sync keeps their weights in step.",
    ]);
  return empty("No spools on 3DFilamentProfiles", [
    "Your 3DFP account has no spools yet: add them there, and they show here within the hour.",
  ]);
}

function listSubtitle(model: AddModel): string {
  const { list } = model.tdfp;
  if (list.state !== "ready") return "";
  const importable = list.rows.filter((row) => row.refusal === null).length;
  return [`${importable} to import`, list.linked > 0 ? `${list.linked} linked` : ""]
    .filter(Boolean)
    .join(" · ");
}

const LIST_TITLE = "Your 3DFP spools";

/** What importing the highlighted spool writes, as lines: the plan when the catalog had its record, else what's read on Review. */
function importLines(row: ImportPreviewRow, ctx: Ctx, width: number): Segment[][] {
  if (row.refusal !== null)
    return [
      [{ text: " ✗ Not imported", color: COLORS.failed, bold: true }],
      ...wrapped(row.refusal, width, COLORS.muted, "  "),
    ];
  const printers = printersOf(ctx.values).map(shortPrinter).join(", ") || "your printers";
  const mark = (text: string, sign = "+"): Segment[][] =>
    wrapped(text, width, undefined, `${sign} `).map((segments, index) =>
      index === 0
        ? [
            { text: ` ${sign} `, color: sign === "+" ? COLORS.ok : COLORS.warning },
            { text: (segments[0]?.text ?? "").slice(3) },
          ]
        : segments,
    );
  const { item } = row;
  if (!item)
    return [
      [muted(" Importing it writes")],
      ...mark(`BambuStudio presets for ${printers}`),
      ...mark("SpoolEase's custom filament and a spool, linked to this one"),
      ...mark("Its preset name and print settings: read from 3DFP on Review (1 API call)", "?"),
    ];
  return [
    [muted(" Importing it writes")],
    ...mark(`BambuStudio presets for ${printers}`),
    ...mark(`SpoolEase's custom filament ${item.profile.filamentId}`),
    ...mark("a SpoolEase spool, linked to this one"),
    [],
    ...previewSettings(item).flatMap((text) => wrapped(text, width, COLORS.muted)),
  ];
}

/** The print settings a spool's preset gets as far as the catalog says; its own calibration is read on Review. */
function previewSettings(item: ImportItem): string[] {
  const parts = settingsParts(item.profile.settings);
  return [
    parts.length
      ? `Print settings: ${parts.join(" · ")} (3DFP's record)`
      : "Print settings: Generic's (3DFP has none)",
    ...(item.calibrated ? ["Your calibration goes first: read on Review (1 API call)"] : []),
  ];
}

function facts(row: ImportPreviewRow): DetailRow[] {
  const { spool, item } = row;
  return [
    { label: "Left", value: formatGrams(spool.remainingGrams) },
    ...(item
      ? [
          {
            label: "Nozzle",
            value: formatRange(item.profile.nozzleTempMin, item.profile.nozzleTempMax),
          },
        ]
      : []),
    ...(spool.emptySpoolWeight
      ? [{ label: "Empty spool", value: formatGrams(spool.emptySpoolWeight) }]
      : []),
    ...(spool.location ? [{ label: "Location", value: spool.location }] : []),
    { label: "3DFP spool", value: spool.shortCode, dim: true },
    ...(item ? [{ label: "Filament ID", value: item.profile.filamentId, dim: true }] : []),
  ];
}

function DetailPanel({
  model,
  ctx,
  box,
  compact,
}: {
  model: AddModel;
  ctx: Ctx;
  box: Area;
  compact: boolean;
}) {
  const row = listRow(model);
  const inner = panelInner(box.width, box.height);
  const ticked = row ? model.tdfp.selected.has(row.spool.shortCode) : false;
  if (!row) return <Panel title="" width={box.width} height={box.height} />;
  const title = row.item?.profile.name ?? spoolName(row.spool);
  if (compact) {
    const { spool, item } = row;
    const summary = [
      `${formatGrams(spool.remainingGrams)} left`,
      ...(spool.emptySpoolWeight ? [`empty ${formatGrams(spool.emptySpoolWeight)}`] : []),
      ...(item ? [formatRange(item.profile.nozzleTempMin, item.profile.nozzleTempMax)] : []),
    ].join(" · ");
    const lines: Segment[][] = [
      [
        { text: " " },
        ...swatchSegments(spoolSwatch(spool), 4),
        ...(ticked ? [{ text: " ✓ ticked", color: COLORS.ok, bold: true }] : []),
        muted(`  ${spool.shortCode}${item ? ` · ${item.profile.filamentId}` : ""}`),
      ],
      [{ text: ` ${summary}` }],
      ...(row.refusal !== null
        ? wrapped(`✗ ${row.refusal}`, inner.width, COLORS.failed)
        : row.item
          ? [
              [
                muted(" Writes "),
                { text: "+ presets · + custom filament · + spool · + link", color: COLORS.ok },
              ],
              ...previewSettings(row.item).flatMap((text) =>
                wrapped(text, inner.width, COLORS.muted),
              ),
            ]
          : wrapped(
              "Writes presets, the custom filament, a spool and a link; its record is read on Review (1 API call)",
              inner.width,
              COLORS.muted,
            )),
    ];
    return (
      <Panel title={title} width={box.width} height={box.height}>
        <Lines lines={lines.slice(0, inner.height)} width={inner.width} />
      </Panel>
    );
  }
  const head = 3 + (ticked ? 1 : 0) + facts(row).length + 1;
  return (
    <Panel title={title} width={box.width} height={box.height}>
      <Box paddingLeft={1}>
        <Swatch color={spoolSwatch(row.spool)} width={Math.max(0, inner.width - 2)} height={2} />
      </Box>
      {ticked ? (
        <Line
          width={inner.width}
          segments={[{ text: " ✓ ticked", color: COLORS.ok, bold: true }]}
        />
      ) : null}
      <Line width={inner.width} segments={[]} />
      <Detail width={inner.width} rows={facts(row)} />
      <Line width={inner.width} segments={[]} />
      <Lines
        lines={importLines(row, ctx, inner.width).slice(0, Math.max(0, inner.height - head))}
        width={inner.width}
      />
    </Panel>
  );
}

/** Find on the 3DFP list: the spools beside what importing the highlighted one writes; one panel for a state. */
export function TdfpFindView({ model, ctx }: { model: AddModel; ctx: Ctx }) {
  const area = pageArea(ctx.bodyColumns, ctx.bodyRows);
  const rows = listRows(model);
  if (!consoleKey(ctx.values) || rows.length === 0) {
    const inner = panelInner(area.width, area.height);
    return (
      <Panel title={LIST_TITLE} focused width={area.width} height={area.height}>
        <ListState model={model} ctx={ctx} box={inner} />
      </Panel>
    );
  }
  const split = splitPage(area);
  const inner = panelInner(split.list.width, split.list.height);
  const cursor = Math.min(model.stack.at(-1)?.cursor ?? 0, rows.length - 1);
  const subtitle = listSubtitle(model);
  return (
    <Box flexDirection={split.side ? "row" : "column"} flexShrink={0}>
      <Panel
        title={LIST_TITLE}
        {...(subtitle ? { subtitle } : {})}
        focused
        width={split.list.width}
        height={split.list.height}
        footerRight={listPosition(cursor, rows.length)}
      >
        <List
          rows={rows.map((row) => tdfpListRow(row, model.tdfp.selected))}
          cursor={cursor}
          height={inner.height}
          width={inner.width}
        />
      </Panel>
      {split.detail.height >= 3 ? (
        <DetailPanel model={model} ctx={ctx} box={split.detail} compact={!split.side} />
      ) : null}
    </Box>
  );
}

// ── Review and Run/Done ─────────────────────────────────────────────────────

const LABEL = 11;

function targetRows(model: AddModel, ctx: Ctx, width: number): DetailRow[] {
  const { values } = ctx;
  const printers = printersOf(values);
  const connection = consoleOf(values);
  const review = model.tdfp.review;
  const room = Math.max(8, width - LABEL - 18);
  const calls =
    review?.state === "ready"
      ? `${plural(review.calls, "API call")} read, ${review.linkCalls} to apply`
      : review?.state === "failed"
        ? "couldn't be read"
        : "reading…";
  return [
    {
      label: "Presets",
      value: `${fitPath(tildePath(bambuBaseFilamentDir(values.presetFolder.trim())), room)} · existing ${values.overwritePresets ? "replaced" : "kept"}`,
    },
    {
      label: "Printers",
      value: printers.map(shortPrinter).join(", ") || "none: choose in Settings (s)",
      ...(printers.length === 0 ? { tone: "failed" as const } : {}),
    },
    connection && !values.skipSpoolease
      ? { label: "SpoolEase", value: `${consoleUrl(connection)} · filaments + spools` }
      : {
          label: "SpoolEase",
          value: "not set up: fix it in Settings (s)",
          tone: "failed" as const,
        },
    { label: "3DFP", value: `links + SpoolEase IDs · ${calls}` },
  ];
}

const CARD = 6;

/** Done's lines: what failed, whether to restart BambuStudio, and what to do next. */
function doneProse(run: TdfpRunModel, width: number): Segment[][] {
  const failures = run.outcomes.filter((o) => o.spoolId === null);
  return [
    ...failures
      .flatMap((o) =>
        wrapped(`${o.code} ${o.name}: ${o.error ?? "not imported"}`, width, COLORS.failed),
      )
      .slice(0, 3),
    ...(run.wrotePresets ? [[muted(" Restart BambuStudio to see the new presets.")]] : []),
    ...(newSpoolIds(run).length > 0
      ? wrapped(
          "Weigh them on SpoolEase: bambu-hando 3dfp sync then keeps the weights in step.",
          width,
          COLORS.muted,
        )
      : []),
  ];
}

function cardHeight(model: AddModel, width: number): number {
  const { run } = model.tdfp;
  if (run?.state !== "done") return CARD;
  return Math.max(CARD, 3 + doneProse(run, panelInner(width, CARD).width).length);
}

function Card({ model, ctx, width }: { model: AddModel; ctx: Ctx; width: number }) {
  const inner = panelInner(width, CARD);
  const { run, review } = model.tdfp;
  const count = run?.items.length ?? review?.codes.length ?? 0;
  if (!run)
    return (
      <Panel
        title="Review"
        subtitle={`${plural(count, "spool")} from 3DFilamentProfiles · nothing written yet`}
        width={width}
        height={CARD}
      >
        <Detail rows={targetRows(model, ctx, inner.width)} width={inner.width} />
      </Panel>
    );
  if (run.state === "running")
    return (
      <Panel
        title="Running"
        subtitle={`importing ${plural(count, "spool")}`}
        focused
        width={width}
        height={CARD}
      >
        <Box paddingLeft={1}>
          <Busy message={`${run.stage ? STAGE_LABELS[run.stage] : "Starting"}…`} />
        </Box>
        <Line width={inner.width} segments={[]} />
        <Lines
          lines={wrapped(
            "Then a SpoolEase spool for each, and the links with their SpoolEase IDs on 3DFP.",
            inner.width,
            COLORS.muted,
          ).slice(0, 2)}
          width={inner.width}
        />
      </Panel>
    );
  if (run.state === "failed")
    return (
      <Panel title="Failed" focused width={width} height={CARD}>
        <Lines
          lines={wrapped(`✗ ${run.error}`, inner.width, COLORS.failed).slice(0, 2)}
          width={inner.width}
        />
        <Line width={inner.width} segments={[]} />
        <Line
          width={inner.width}
          segments={[muted(" Your ticks are kept: fix the cause and apply again.")]}
        />
      </Panel>
    );
  const made = newSpoolIds(run).length;
  const failed = run.outcomes.length - made;
  const height = cardHeight(model, width);
  return (
    <Panel
      title="Done"
      subtitle={`from 3DFilamentProfiles · ${plural(run.calls, "API call")}`}
      focused
      width={width}
      height={height}
    >
      <Line
        width={inner.width}
        segments={[
          ...(made > 0 || failed === 0
            ? [{ text: ` ✓ ${plural(made, "spool")} imported`, color: COLORS.ok, bold: true }]
            : []),
          ...(failed > 0
            ? [{ text: ` ✗ ${failed} failed`, color: COLORS.failed, bold: true }]
            : []),
        ]}
      />
      <Lines lines={doneProse(run, inner.width)} width={inner.width} />
    </Panel>
  );
}

interface Columns {
  name: number;
  code: number;
  /** 0 on Done, which has no plan: the column and its title are left out. */
  preset: number;
  spoolease: number;
}

type Titles = Record<keyof Columns, string>;

const REVIEW_TITLES: Titles = {
  name: "Spool",
  code: "3DFP",
  preset: "Presets",
  spoolease: "SpoolEase",
};
const RUN_TITLES: Titles = { name: "Spool", code: "3DFP", preset: "", spoolease: "Result" };

/** The table's widths: the code, preset and SpoolEase columns as wide as they need, the name the rest. */
function columns(rows: TableRow[], width: number, titles: Titles): Columns {
  const widest = (texts: string[], title: string, max: number) =>
    title ? Math.min(max, Math.max(textWidth(title), ...texts.map(textWidth))) : 0;
  const code = widest(
    rows.map((r) => r.code),
    titles.code,
    12,
  );
  const preset = widest(
    rows.map((r) => r.preset),
    titles.preset,
    12,
  );
  const spoolease = widest(
    rows.map((r) => r.spoolease),
    titles.spoolease,
    22,
  );
  const gaps = preset > 0 ? 3 : 2;
  // The gutter, chip and gap before the cells, the gaps between them, and the scroll thumb's two columns.
  const rest = Math.max(6, width - 4 - 2 - gaps - code - preset - spoolease);
  // No wider than the longest name, so the columns sit beside the names on a wide terminal.
  const name = Math.min(rest, Math.max(14, ...rows.map((r) => textWidth(r.name))));
  return { name, code, preset, spoolease };
}

interface TableRow {
  key: string;
  swatch: string;
  name: string;
  code: string;
  preset: string;
  presetColor: string;
  spoolease: string;
  spooleaseColor: string;
}

const TONE_COLORS = { new: COLORS.ok, change: COLORS.warning, same: COLORS.muted } as const;

function reviewTableRow(row: ReviewRow, overwrite: boolean): TableRow {
  if (row.kind === "refused")
    return {
      key: `refused:${row.code}`,
      swatch: row.spool ? spoolSwatch(row.spool) : "#808080",
      name: row.spool ? spoolName(row.spool) : row.code,
      code: row.code,
      preset: "-",
      presetColor: COLORS.muted,
      spoolease: "✗ not imported",
      spooleaseColor: COLORS.failed,
    };
  const { item, plan } = row;
  const preset = plan ? presetPlanText(plan, overwrite) : null;
  const filament = plan?.filament?.state;
  // The custom filament row (added, updated, there already, or unknown when SpoolEase wasn't read), then the rest.
  const row0 =
    filament === "new" ? "add" : filament === "update" ? "update" : filament === "same" ? "" : "?";
  return {
    key: `item:${item.spool.shortCode}`,
    swatch: `#${item.profile.colorRgba.slice(0, 6)}`,
    name: item.profile.name,
    code: item.spool.shortCode,
    preset: preset?.text ?? "?",
    presetColor: preset ? TONE_COLORS[preset.tone] : COLORS.warning,
    spoolease: [row0, "spool", "link"].filter(Boolean).join(" + "),
    spooleaseColor: filament === "update" || row0 === "?" ? COLORS.warning : COLORS.ok,
  };
}

function runTableRow(run: TdfpRunModel, index: number): TableRow {
  // biome-ignore lint/style/noNonNullAssertion: index comes from run.items.
  const item = run.items[index]!;
  const outcome = run.outcomes.find((o) => o.code === item.spool.shortCode);
  const status =
    run.state === "running"
      ? { text: "… working", color: COLORS.accent }
      : run.state === "failed"
        ? { text: "- not imported", color: COLORS.muted }
        : outcome?.spoolId
          ? { text: `✓ spool #${outcome.spoolId}`, color: COLORS.ok }
          : { text: "✗ failed", color: COLORS.failed };
  return {
    key: `run:${item.spool.shortCode}:${index}`,
    swatch: `#${item.profile.colorRgba.slice(0, 6)}`,
    name: item.profile.name,
    code: item.spool.shortCode,
    preset: "",
    presetColor: COLORS.muted,
    spoolease: status.text,
    spooleaseColor: status.color,
  };
}

function toListRow(row: TableRow, widths: Columns): ListRow {
  const cells: Cell[] = [
    { text: row.name, width: widths.name },
    { text: row.code, width: widths.code, dim: true },
    { text: row.preset, width: widths.preset, color: row.presetColor },
    { text: row.spoolease, width: widths.spoolease, color: row.spooleaseColor },
  ];
  return { key: row.key, swatch: row.swatch, cells: cells.filter((cell) => (cell.width ?? 0) > 0) };
}

function headerSegments(widths: Columns, titles: Titles): Segment[] {
  return [
    { text: "    " },
    ...(["name", "code", "preset", "spoolease"] as const)
      .filter((key) => widths[key] > 0)
      .map((key) => muted(`${fitText(titles[key], widths[key])} `)),
  ];
}

/** The lines under the table: the highlighted row in full, warnings, and why apply refused. */
function footerLines(model: AddModel, ctx: Ctx, width: number): Segment[][] {
  const { review, run } = model.tdfp;
  const lines: Segment[][] = [];
  if (run) {
    const item = run.items[run.cursor];
    const outcome = item && run.outcomes.find((o) => o.code === item.spool.shortCode);
    if (outcome?.error)
      lines.push(...wrapped(`✗ ${outcome.code}: ${outcome.error}`, width, COLORS.failed));
    if (outcome?.warning)
      lines.push(...wrapped(`! ${outcome.code}: ${outcome.warning}`, width, COLORS.warning));
    for (const warning of run.warnings)
      lines.push(...wrapped(warning, width, COLORS.warning, "! "));
    return lines;
  }
  if (!review) return lines;
  if (review.state === "failed") {
    const fix =
      review.problem === "spoolease"
        ? " (s fixes it in Settings)"
        : review.problem === "noKey"
          ? ""
          : " (r reads it again)";
    lines.push(...wrapped(`${review.error}${fix}`, width, COLORS.failed, "✗ "));
  }
  const row = reviewRows(model)[review.cursor];
  if (row?.kind === "item") {
    const printers = printersOf(ctx.values).map(shortPrinter).join(", ");
    lines.push(
      ...wrapped(
        `${row.item.spool.shortCode} → preset "${row.item.profile.name}" for ${printers || "no printer"} · SpoolEase filament ${row.item.profile.filamentId} · a new spool · linked`,
        width,
      ),
      ...wrapped(`Print settings: ${importSettingsText(row.item)}`, width, COLORS.muted),
    );
  } else if (row?.kind === "refused")
    lines.push(...wrapped(`${row.code}: ${row.reason}`, width, COLORS.failed, "✗ "));
  for (const warning of review.warnings)
    lines.push(...wrapped(warning, width, COLORS.warning, "! "));
  const error = review.refusal || importError(ctx.values);
  if (error)
    lines.push(
      ...wrapped(
        `${error}${/Settings/.test(error) ? "" : " (s fixes it in Settings)"}`,
        width,
        COLORS.failed,
        "✗ ",
      ),
    );
  return lines;
}

/** Review and Run/Done of an import: the targets (or the run's state) over a row per spool. */
export function TdfpPlanView({ model, ctx }: { model: AddModel; ctx: Ctx }) {
  const area = pageArea(ctx.bodyColumns, ctx.bodyRows);
  const { run, review } = model.tdfp;
  const card = cardHeight(model, area.width);
  const footer = footerLines(model, ctx, area.width).slice(0, Math.max(0, area.height - card - 4));
  const tableHeight = Math.max(4, area.height - card - footer.length);
  const inner = panelInner(area.width, tableHeight);
  const rows: TableRow[] = run
    ? run.items.map((_, index) => runTableRow(run, index))
    : reviewRows(model).map((row) => reviewTableRow(row, ctx.values.overwritePresets));
  const titles = run ? RUN_TITLES : REVIEW_TITLES;
  const widths = columns(rows, inner.width, titles);
  const cursor = run ? run.cursor : (review?.cursor ?? 0);
  const loading = !run && review?.state === "loading";
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Card model={model} ctx={ctx} width={area.width} />
      <Panel
        title="Import"
        subtitle={run ? "what the run did" : "what applying does"}
        focused={run?.state !== "running"}
        width={area.width}
        height={tableHeight}
        footerRight={listPosition(cursor, rows.length)}
      >
        <Line width={inner.width} segments={headerSegments(widths, titles)} />
        {loading ? (
          <Box paddingLeft={1}>
            <Busy message="Reading 3DFP's records and what's there already…" />
          </Box>
        ) : rows.length === 0 ? (
          <Line width={inner.width} segments={centered([muted("Nothing to show")], inner.width)} />
        ) : (
          <List
            rows={rows.map((row) => toListRow(row, widths))}
            cursor={Math.min(cursor, Math.max(0, rows.length - 1))}
            height={Math.max(0, inner.height - 1)}
            width={inner.width}
          />
        )}
      </Panel>
      <Lines lines={footer} width={area.width} />
    </Box>
  );
}
