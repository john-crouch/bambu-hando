// ABOUTME: The Find page: the drill-down or search list in one panel, the highlighted row's detail in the other.
// ABOUTME: Render-only; rows, detail data and the cursor come from the model through catalog.ts and update.ts.

import { Box } from "ink";

import type { Ctx } from "../../core/types.js";
import { formatRange, plural } from "../../ui/format.js";
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
import { fitText, textWidth } from "../../ui/text.js";
import { COLORS } from "../../ui/theme.js";
import {
  type AddLine,
  type FindDetail,
  type FindRow,
  type Level,
  SPOOLMANDB_LABEL,
  swatchOf,
} from "./catalog.js";
import type { Box as Area } from "./layout.js";
import { pageArea, splitPage } from "./layout.js";
import { type AddModel, sourcesOf } from "./model.js";
import { detailTitle, findDetailOf } from "./peek.js";
import { findRows } from "./update.js";
import { wrapText } from "./wrap.js";

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
          // The code is for the detail panel: the list keeps its width for the name.
          { text: formatRange(profile.nozzleTempMin, profile.nozzleTempMax), width: 9 },
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
  if (model.search)
    return { title: "Search SpoolmanDB", subtitle: plural(rows.length, "match", "matches") };
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
    case "missing":
      return { title: "Not in SpoolmanDB", subtitle: "" };
  }
}

function currentLevel(model: AddModel): Level {
  return model.stack.at(-1)?.level ?? { kind: "brands" };
}

/** What fills the list panel when there are no rows: loading, failed, or nothing found. */
function emptyState(model: AddModel, ctx: Ctx, inner: Area) {
  const level = currentLevel(model);
  if (!model.search && level.kind === "missing")
    return (
      <Empty
        title={`${level.name || level.id} isn't in SpoolmanDB`}
        lines={[
          level.name
            ? `Nothing listed has its ID (${level.id}) or its name.`
            : "Nothing listed has its ID.",
          "Add it from a file or URL in Settings › Import, or search for a close one.",
        ].flatMap((line) => wrapText(line, Math.max(1, inner.width - 4)))}
        action={{ keys: "enter", label: "open Settings › Import" }}
        width={inner.width}
        height={inner.height}
      />
    );
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

const CHECKING = "Checking what's there already…";

const MARK_COLORS: Record<AddLine["mark"], string> = {
  "+": COLORS.ok,
  "=": COLORS.muted,
  "↻": COLORS.warning,
  "?": COLORS.warning,
};

/** What adding the color does, a line per target, each wrapped under its mark. */
function AddLines({ adds, width }: { adds: AddLine[]; width: number }) {
  return (
    <>
      <Line width={width} segments={[muted(" Adding it")]} />
      {adds.flatMap((line) =>
        wrapText(line.text, Math.max(1, width - 4)).map((text, index) => (
          <Line
            key={`${line.text}:${text}`}
            width={width}
            segments={[
              { text: index === 0 ? ` ${line.mark} ` : "   ", color: MARK_COLORS[line.mark] },
              { text, ...(line.mark === "=" ? { color: COLORS.muted } : {}) },
            ]}
          />
        )),
      )}
    </>
  );
}

/**
 * A color's detail in the few lines a stacked panel has: swatch and code, the facts on one line, then
 * what adding writes: a line per target when they fit, else all of them on one line.
 */
function CompactColor({
  detail,
  width,
  height,
}: {
  detail: Extract<FindDetail, { kind: "color" }>;
  width: number;
  height: number;
}) {
  const fact = (label: string) => detail.facts.find((f) => f.label === label)?.value ?? "";
  const room = height - 2;
  const adds = detail.adds;
  const perLine = adds !== null && room >= adds.length + 1;
  return (
    <>
      <Line
        width={width}
        segments={[
          { text: " " },
          ...swatchSegments(detail.swatch, 4),
          ...(detail.ticked ? [{ text: " ✓ ticked", color: COLORS.ok, bold: true }] : []),
          muted(`  ${fact("Code")}`),
        ]}
      />
      <Line
        width={width}
        segments={[
          {
            text: ` ${fact("Nozzle")} · ${fact("Filament")} · empty ${fact("Empty spool")} · ${fact("Density")}`,
          },
        ]}
      />
      {adds === null ? (
        room > 0 ? (
          <Line width={width} segments={[muted(` ${CHECKING}`)]} />
        ) : null
      ) : perLine ? (
        <>
          {room >= adds.length + 2 ? <Line width={width} segments={[]} /> : null}
          <AddLines adds={adds} width={width} />
        </>
      ) : room > 0 ? (
        <Line
          width={width}
          segments={[
            muted(" Adding it "),
            ...adds.flatMap((line, index) => [
              ...(index > 0 ? [muted(" · ")] : []),
              { text: line.short, color: MARK_COLORS[line.mark] },
            ]),
          ]}
        />
      ) : null}
    </>
  );
}

/** A material's colors with their nozzle ranges in one aligned column. */
function MaterialColors({
  colors,
  width,
}: {
  colors: Extract<FindDetail, { kind: "material" }>["colors"];
  width: number;
}) {
  const temps = colors.map((p) => formatRange(p.nozzleTempMin, p.nozzleTempMax));
  const tempWidth = Math.max(0, ...temps.map(textWidth));
  const nameWidth = Math.max(
    4,
    Math.min(
      Math.max(0, ...colors.map((p) => textWidth(p.colorName || p.name))),
      width - tempWidth - 7,
    ),
  );
  return (
    <>
      {colors.map((p, index) => (
        <Line
          key={p.filamentId}
          width={width}
          segments={[
            { text: " " },
            ...swatchSegments(swatchOf(p), 2),
            { text: ` ${fitText(p.colorName || p.name, nameWidth)}  ` },
            muted(temps[index] ?? ""),
          ]}
        />
      ))}
    </>
  );
}

function DetailBody({
  detail,
  width,
  height,
  compact,
}: {
  detail: FindDetail;
  width: number;
  height: number;
  compact: boolean;
}) {
  switch (detail.kind) {
    case "source":
    case "other":
      return (
        <>
          {detail.lines
            .flatMap((line) => wrapText(line, Math.max(1, width - 1)))
            .map((line) => (
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
      return <MaterialColors colors={detail.colors} width={width} />;
    case "color":
      if (compact) return <CompactColor detail={detail} width={width} height={height} />;
      return (
        <>
          <Box paddingLeft={1}>
            <Swatch color={detail.swatch} width={Math.max(0, width - 2)} height={2} />
          </Box>
          {detail.ticked ? (
            <Line width={width} segments={[{ text: " ✓ ticked", color: COLORS.ok, bold: true }]} />
          ) : null}
          <Line width={width} segments={[]} />
          <Detail width={width} rows={detail.facts} />
          <Line width={width} segments={[]} />
          {detail.adds === null ? (
            <Line width={width} segments={[muted(` ${CHECKING}`)]} />
          ) : (
            <AddLines adds={detail.adds} width={width} />
          )}
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
  const detail = findDetailOf(model, ctx);
  const inner = panelInner(box.width, box.height);
  const title = detailTitle(model, ctx, detail);
  return (
    <Panel title={title} width={box.width} height={box.height}>
      {detail ? (
        <DetailBody detail={detail} width={inner.width} height={inner.height} compact={compact} />
      ) : null}
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
