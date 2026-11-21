// ABOUTME: The Find page: the drill-down or search list in one panel, the highlighted row's detail in the other.
// ABOUTME: Render-only; rows, detail data and the cursor come from the model through catalog.ts and update.ts.

import { Box } from "ink";

import type { Ctx } from "../../core/types.js";
import {
  Busy,
  Detail,
  Empty,
  Line,
  List,
  type ListRow,
  listPosition,
  Panel,
  panelInner,
  type Segment,
  Swatch,
  TextField,
} from "../../ui/index.js";
import { swatchSegments } from "../../ui/Swatch.js";
import { COLORS } from "../../ui/theme.js";
import {
  type FindDetail,
  type FindRow,
  findDetail,
  type Level,
  materialsOf,
  SPOOLMANDB_LABEL,
  swatchOf,
  tempsText,
} from "./catalog.js";
import type { Box as Area } from "./layout.js";
import { pageArea, splitPage } from "./layout.js";
import { type AddModel, sourcesOf } from "./model.js";
import { findRows } from "./update.js";

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : /(ch|sh|s|x)$/.test(noun) ? "es" : "s"}`;
}

const tickCell = (ticked: boolean) =>
  ticked
    ? { text: "[✓]", width: 3, color: COLORS.ok }
    : { text: "[ ]", width: 3, color: COLORS.muted };

function countCells(count: number, ticked: number, noun: string) {
  return [
    { text: plural(count, noun), width: 15, align: "right" as const, dim: true },
    ticked > 0 ? { text: `✓ ${ticked}`, width: 6, color: COLORS.ok } : { text: "", width: 6 },
  ];
}

/** A Find row as a list row. */
export function listRow(row: FindRow, selected: ReadonlySet<string>): ListRow {
  switch (row.kind) {
    case "source":
    case "brand":
    case "material":
      return {
        key: `${row.kind}:${row.label}`,
        cells: [
          { text: row.label, grow: true },
          ...countCells(row.count, row.ticked, row.kind === "source" ? "filament" : "color"),
        ],
      };
    case "color": {
      const { profile } = row;
      return {
        key: row.key,
        swatch: swatchOf(profile),
        cells: [
          tickCell(selected.has(row.key)),
          { text: row.label, grow: true },
          { text: tempsText(profile.nozzleTempMin, profile.nozzleTempMax), width: 9 },
          { text: profile.filamentId, width: 8, dim: true },
        ],
      };
    }
    case "other":
      return {
        key: "other",
        cells: [
          { text: " + ", width: 3, color: COLORS.accent2 },
          { text: row.label, grow: true, color: COLORS.accent2 },
        ],
      };
  }
}

/** The list panel's title and subtitle for where Find is. */
export function findTitle(model: AddModel, ctx: Ctx): { title: string; subtitle: string } {
  const rows = findRows(model, ctx);
  if (model.search) return { title: "Search SpoolmanDB", subtitle: plural(rows.length, "match") };
  const level = model.stack.at(-1)?.level ?? { kind: "brands" };
  switch (level.kind) {
    case "root":
      return { title: "Add from", subtitle: "" };
    case "brands":
      return { title: SPOOLMANDB_LABEL, subtitle: plural(rows.length, "brand") };
    case "materials":
      return { title: level.brand, subtitle: plural(rows.length, "material") };
    case "colors":
      return {
        title: `${level.brand} ${level.material}`,
        subtitle: plural(rows.length - 1, "color"),
      };
    case "import":
      return {
        title: sourcesOf(model, ctx).importName ?? "Import",
        subtitle: plural(rows.length, "filament"),
      };
  }
}

function currentLevel(model: AddModel): Level {
  return model.stack.at(-1)?.level ?? { kind: "brands" };
}

/** What fills the list panel when there are no rows: loading, failed, or nothing found. */
function emptyState(model: AddModel, ctx: Ctx, inner: Area) {
  const level = currentLevel(model);
  if (!model.search && level.kind === "import") {
    if (model.imported.state === "failed")
      return (
        <Empty
          title={`Couldn't read ${sourcesOf(model, ctx).importName ?? "the import"}`}
          lines={[model.imported.error]}
          width={inner.width}
          height={inner.height}
        />
      );
    return (
      <Box paddingLeft={1}>
        <Busy message="Reading the import…" />
      </Box>
    );
  }
  const catalog = ctx.resources.catalog;
  if (catalog.state === "failed" && sourcesOf(model, ctx).db.length === 0)
    return (
      <Empty
        title="Couldn't load SpoolmanDB"
        lines={[catalog.error]}
        action={{ keys: "r", label: "try again" }}
        width={inner.width}
        height={inner.height}
      />
    );
  if (catalog.state !== "ready" && sourcesOf(model, ctx).db.length === 0)
    return (
      <Box paddingLeft={1}>
        <Busy message="Loading SpoolmanDB…" />
      </Box>
    );
  return (
    <Empty
      title="No matches"
      lines={["Bambu Lab filaments are never listed:", "BambuStudio ships its own presets."]}
      width={inner.width}
      height={inner.height}
    />
  );
}

function ListPanel({ model, ctx, box }: { model: AddModel; ctx: Ctx; box: Area }) {
  const rows = findRows(model, ctx);
  const inner = panelInner(box.width, box.height);
  const { title, subtitle } = findTitle(model, ctx);
  const search = model.search;
  const cursor = search ? search.cursor : (model.stack.at(-1)?.cursor ?? 0);
  const listHeight = Math.max(0, inner.height - (search ? 2 : 0));
  return (
    <Panel
      title={title}
      {...(subtitle ? { subtitle } : {})}
      focused
      width={box.width}
      height={box.height}
      footerRight={listPosition(cursor, rows.length)}
    >
      {search ? (
        <>
          <Box>
            <Line
              width={3}
              segments={[
                { text: " / ", color: search.focus === "query" ? COLORS.accent : COLORS.muted },
              ]}
            />
            <TextField
              value={search.text.value}
              cursor={search.text.cursor}
              focused={search.focus === "query"}
              placeholder="type words of the name"
              width={Math.max(0, inner.width - 3)}
            />
          </Box>
          <Line width={inner.width} segments={[]} />
        </>
      ) : null}
      {rows.length === 0 ? (
        emptyState(model, ctx, { width: inner.width, height: listHeight })
      ) : (
        <List
          rows={rows.map((row) => listRow(row, model.selected))}
          cursor={Math.min(cursor, rows.length - 1)}
          height={listHeight}
          width={inner.width}
          focused={!search || search.focus === "list"}
          {...(search?.text.value ? { highlight: search.text.value } : {})}
        />
      )}
    </Panel>
  );
}

const muted = (text: string): Segment => ({ text, color: COLORS.muted });

function chipLine(color: string, text: string, detail: string, width: number) {
  return (
    <Line
      width={width}
      segments={[{ text: " " }, ...swatchSegments(color, 2), { text: ` ${text}  ` }, muted(detail)]}
    />
  );
}

/** The detail panel's lines for the highlighted row. */
/** A color's detail in the few lines a stacked panel has: one line of facts, one of what adding writes. */
function CompactColor({
  detail,
  width,
}: {
  detail: Extract<FindDetail, { kind: "color" }>;
  width: number;
}) {
  const fact = (label: string) => detail.facts.find((f) => f.label === label)?.value ?? "";
  return (
    <>
      <Line
        width={width}
        segments={[
          { text: " " },
          ...swatchSegments(detail.swatch, 4),
          detail.ticked
            ? { text: " ✓ ticked", color: COLORS.ok, bold: true }
            : muted(" space ticks it"),
        ]}
      />
      <Line
        width={width}
        segments={[
          {
            text: ` ${fact("Nozzle")} · ${fact("Filament")} · empty ${fact("Empty spool")} · ${fact("Density")}  `,
          },
          muted(fact("Code")),
        ]}
      />
      <Line width={width} segments={[]} />
      <Line width={width} segments={[muted(" Adding it writes")]} />
      <Line
        width={width}
        segments={[{ text: " + ", color: COLORS.ok }, { text: detail.adds.join(" · ") }]}
      />
    </>
  );
}

function DetailBody({
  detail,
  width,
  compact,
}: {
  detail: FindDetail;
  width: number;
  compact: boolean;
}) {
  switch (detail.kind) {
    case "source":
    case "other":
      return (
        <>
          {detail.lines.map((line) => (
            <Line key={line} width={width} segments={[{ text: " " }, muted(line)]} />
          ))}
        </>
      );
    case "brand":
      return (
        <Detail
          width={width}
          rows={detail.materials.map((m) => ({
            label: m.label,
            value: `${plural(m.count, "color")}${m.ticked ? ` · ${m.ticked} ticked` : ""}`,
            ...(m.ticked ? { tone: "ok" as const } : {}),
          }))}
        />
      );
    case "material":
      return (
        <>
          {detail.colors.map((p) => (
            <Box key={p.filamentId}>
              {chipLine(
                swatchOf(p),
                p.colorName || p.name,
                tempsText(p.nozzleTempMin, p.nozzleTempMax),
                width,
              )}
            </Box>
          ))}
        </>
      );
    case "color":
      if (compact) return <CompactColor detail={detail} width={width} />;
      return (
        <>
          <Box paddingLeft={1}>
            <Swatch color={detail.swatch} width={Math.max(0, width - 2)} height={2} />
          </Box>
          <Line
            width={width}
            segments={
              detail.ticked
                ? [{ text: " ✓ ticked", color: COLORS.ok, bold: true }]
                : [muted(" space ticks it")]
            }
          />
          <Line width={width} segments={[]} />
          <Detail width={width} rows={detail.facts} />
          <Line width={width} segments={[]} />
          <Line width={width} segments={[muted(" Adding it writes")]} />
          {detail.adds.map((line) => (
            <Line
              key={line}
              width={width}
              segments={[{ text: " + ", color: COLORS.ok }, { text: line }]}
            />
          ))}
        </>
      );
  }
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
  const rows = findRows(model, ctx);
  const cursor = model.search ? model.search.cursor : (model.stack.at(-1)?.cursor ?? 0);
  const row = rows[Math.min(cursor, rows.length - 1)];
  const level = model.search ? null : currentLevel(model);
  const sources = sourcesOf(model, ctx);
  const detail = findDetail(level, row, sources, model.selected, ctx.values);
  const inner = panelInner(box.width, box.height);
  const title =
    detail?.title ??
    (level?.kind === "materials" ? `${materialsOf(sources, level.brand).length} materials` : "");
  return (
    <Panel title={title} width={box.width} height={box.height}>
      {detail ? <DetailBody detail={detail} width={inner.width} compact={compact} /> : null}
    </Panel>
  );
}

export function FindView({ model, ctx }: { model: AddModel; ctx: Ctx }) {
  const split = splitPage(pageArea(ctx.bodyColumns, ctx.bodyRows));
  return (
    <Box flexDirection={split.side ? "row" : "column"} flexShrink={0}>
      <ListPanel model={model} ctx={ctx} box={split.list} />
      {split.detail.height >= 3 ? (
        <DetailPanel model={model} ctx={ctx} box={split.detail} compact={!split.side} />
      ) : null}
    </Box>
  );
}
