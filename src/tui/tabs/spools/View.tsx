// ABOUTME: The Spools tab's view: the spool list with its summary and filter beside the highlighted spool's detail.
// ABOUTME: Below 90 columns the detail replaces the list on enter; empty states say what to do. Dialogs are in Dialogs.tsx.

import { Box } from "ink";
import type { ReactNode } from "react";
import type { InventoryRow } from "../../../spoolInventory.js";
import type { ConsoleData, Ctx } from "../../core/types.js";
import {
  Bar,
  Busy,
  COLORS,
  Detail,
  Empty,
  Line,
  List,
  listPosition,
  Panel,
  panelInner,
  type Segment,
  Swatch,
  TextField,
} from "../../ui/index.js";
import { segmentsWidth } from "../../ui/text.js";
import {
  compactDetail,
  consoleConnection,
  consoleUrl,
  SORT_LABELS,
  spoolDetail,
  spoolsSummary,
  swatchOf,
} from "./data.js";
import {
  COMPACT_DETAIL,
  cursorIndex,
  isWide,
  type SpoolsModel,
  spoolsScreen,
  stacksDetail,
  visibleRows,
} from "./model.js";
import { spoolListRows, summarySegments } from "./rows.js";

/** Lines of the list panel's inside above the rows: the summary and the filter. */
export const LIST_HEAD = 2;
/** The detail panel's width beside the list: the list keeps room for the name and its columns. */
function detailWidth(columns: number): number {
  return Math.min(46, Math.max(34, Math.round(columns * 0.3)));
}

function ListPanel({
  model,
  ctx,
  data,
  rows,
  width,
  height,
  reloading,
  error,
}: {
  model: SpoolsModel;
  ctx: Ctx;
  data: ConsoleData;
  rows: InventoryRow[];
  width: number;
  height: number;
  reloading: boolean;
  error: string | undefined;
}) {
  const inner = panelInner(width, height);
  const cursor = cursorIndex(model, rows);
  const filtered = model.filter.value !== "";
  const subtitle = filtered
    ? `${rows.length} of ${data.spools.length} · ${SORT_LABELS[model.sort]}`
    : SORT_LABELS[model.sort];
  const status: Segment[] = [
    ...(reloading ? [{ text: " · reloading…", color: COLORS.muted }] : []),
    ...(error ? [{ text: ` · ✗ couldn't reload: ${error}`, color: COLORS.failed }] : []),
  ];
  const summary: Segment[] = [
    { text: " " },
    ...summarySegments(
      spoolsSummary(data, ctx.resources.check),
      Math.max(0, inner.width - 2 - segmentsWidth(status)),
    ),
    ...status,
  ];
  const showFilter = model.filtering || filtered;
  return (
    <Panel
      title="Spools"
      subtitle={subtitle}
      focused={!model.dialog}
      width={width}
      height={height}
      footerRight={listPosition(cursor, rows.length)}
    >
      <Line segments={summary} width={inner.width} />
      {showFilter ? (
        <Box flexDirection="row">
          <Line segments={[{ text: " / ", color: COLORS.accent2, bold: true }]} width={3} />
          <TextField
            value={model.filter.value}
            cursor={model.filter.cursor}
            focused={model.filtering}
            placeholder="name, location, code or #id"
            width={inner.width - 3}
          />
        </Box>
      ) : (
        <Line segments={[]} width={inner.width} />
      )}
      {rows.length === 0 ? (
        <Line
          segments={[{ text: " No spool matches every word of the filter.", color: COLORS.muted }]}
          width={inner.width}
        />
      ) : (
        <List
          rows={spoolListRows(rows, model.ticked, inner.width, ctx.now)}
          cursor={cursor}
          height={Math.max(0, inner.height - LIST_HEAD)}
          width={inner.width}
          marker="check"
          highlight={model.filter.value}
          focused={!model.dialog}
        />
      )}
    </Panel>
  );
}

function DetailPanel({
  row,
  data,
  now,
  ticked,
  width,
  height,
  focused,
}: {
  row: InventoryRow | undefined;
  data: ConsoleData;
  now: number;
  ticked: number;
  width: number;
  height: number;
  focused: boolean;
}) {
  const inner = panelInner(width, height);
  if (!row)
    return (
      <Panel title="Spool" width={width} height={height}>
        <Empty title="No spool highlighted" width={inner.width} height={inner.height} />
      </Panel>
    );
  const detail = spoolDetail(row, data.filaments, now);
  const art = inner.width - 2;
  const swatchRows = inner.height >= 24 ? 3 : 2;
  return (
    <Panel
      title={`#${row.spool.id}`}
      focused={focused}
      width={width}
      height={height}
      {...(ticked > 0 ? { footerRight: `${ticked} ticked` } : {})}
    >
      <Box paddingLeft={1} flexDirection="column">
        {detail.swatch ? (
          <Swatch color={detail.swatch} width={art} height={swatchRows} />
        ) : (
          <Line segments={[{ text: "no color on record", color: COLORS.muted }]} width={art} />
        )}
      </Box>
      <Line segments={[]} width={inner.width} />
      <Line segments={[{ text: " " }, { text: detail.title, bold: true }]} width={inner.width} />
      <Line
        segments={[{ text: " " }, { text: detail.subtitle, color: COLORS.muted }]}
        width={inner.width}
      />
      <Line segments={[]} width={inner.width} />
      {row.fraction !== null ? (
        <Box paddingLeft={1} flexDirection="column">
          <Bar fraction={row.fraction} width={art} tone={detail.rows[0]?.tone ?? "accent"} />
          <Line segments={[]} width={art} />
        </Box>
      ) : null}
      <Detail rows={detail.rows} width={inner.width} />
    </Panel>
  );
}

/** The highlighted spool in three lines under the list, for terminals too narrow to show it beside. */
function CompactDetail({
  row,
  data,
  now,
  width,
}: {
  row: InventoryRow | undefined;
  data: ConsoleData;
  now: number;
  width: number;
}) {
  const inner = panelInner(width, COMPACT_DETAIL);
  if (!row)
    return (
      <Panel title="Spool" width={width} height={COMPACT_DETAIL}>
        <Line
          segments={[{ text: " No spool highlighted", color: COLORS.muted }]}
          width={inner.width}
        />
      </Panel>
    );
  const swatch = swatchOf(row.spool.colorCodes);
  const chip: Segment[] = swatch
    ? [{ text: " " }, { text: "  ", backgroundColor: swatch }, { text: " " }]
    : [];
  return (
    <Panel title={`#${row.spool.id} ${row.name}`} width={width} height={COMPACT_DETAIL}>
      <Box flexDirection="row">
        {swatch ? (
          <Box flexDirection="column" width={4} flexShrink={0}>
            <Line segments={chip} width={4} />
            <Line segments={chip} width={4} />
          </Box>
        ) : null}
        <Detail
          rows={compactDetail(row, data.filaments, now)}
          width={inner.width - (swatch ? 4 : 0)}
          labelWidth={8}
        />
      </Box>
    </Panel>
  );
}

function EmptyState({ ctx, width, height }: { ctx: Ctx; width: number; height: number }) {
  const screen = spoolsScreen(ctx);
  const inner = panelInner(width, height);
  const conn = consoleConnection(ctx.values);
  let body: ReactNode = null;
  switch (screen.kind) {
    case "unset":
      body = (
        <Empty
          title={ctx.values.skipSpoolease ? "SpoolEase is skipped" : "No SpoolEase console set up"}
          lines={[
            "This tab shows the spools on your SpoolEase console:",
            "what's left on each, where it is, and labels for them.",
            ctx.values.skipSpoolease
              ? "Turn SpoolEase on in Settings to see them."
              : "Give the console's address and security key in Settings.",
          ]}
          action={{ keys: "enter", label: "open Settings" }}
          width={inner.width}
          height={inner.height}
        />
      );
      break;
    case "loading":
      body = (
        <Box width={inner.width} height={inner.height} justifyContent="center" alignItems="center">
          <Busy message={`Reading spools from ${conn ? consoleUrl(conn) : "SpoolEase"}…`} />
        </Box>
      );
      break;
    case "failed":
      body = (
        <Empty
          title="Couldn't read the console's spools"
          lines={[screen.error, "Check its address in Settings, or press r to try again."]}
          action={{ keys: "enter", label: "open Settings" }}
          width={inner.width}
          height={inner.height}
        />
      );
      break;
    case "empty":
      body = (
        <Empty
          title="No spools on the console yet"
          lines={[
            "Add filaments from SpoolmanDB: bambu-hando writes their",
            "BambuStudio presets and creates a spool for each.",
          ]}
          action={{ keys: "enter", label: "add spools" }}
          width={inner.width}
          height={inner.height}
        />
      );
      break;
    case "list":
      break;
  }
  return (
    <Panel title="Spools" focused width={width} height={height}>
      {body}
    </Panel>
  );
}

export function SpoolsView({ model, ctx }: { model: SpoolsModel; ctx: Ctx }) {
  const width = ctx.bodyColumns;
  const height = ctx.bodyRows;
  const screen = spoolsScreen(ctx);
  let body: ReactNode;
  if (screen.kind !== "list") {
    body = <EmptyState ctx={ctx} width={width} height={height} />;
  } else {
    const rows = visibleRows(model, ctx);
    const row = rows[cursorIndex(model, rows)];
    const list = (listWidth: number, listHeight = height) => (
      <ListPanel
        model={model}
        ctx={ctx}
        data={screen.data}
        rows={rows}
        width={listWidth}
        height={listHeight}
        reloading={screen.reloading}
        error={screen.error}
      />
    );
    const detail = (panelWidth: number, focused: boolean) => (
      <DetailPanel
        row={row}
        data={screen.data}
        now={ctx.now}
        ticked={model.ticked.length}
        width={panelWidth}
        height={height}
        focused={focused}
      />
    );
    if (isWide(ctx)) {
      const side = detailWidth(width);
      body = (
        <>
          {list(width - side)}
          {detail(side, false)}
        </>
      );
    } else if (model.detailOpen) {
      body = detail(width, !model.dialog);
    } else if (stacksDetail(ctx)) {
      body = (
        <Box flexDirection="column" width={width} height={height}>
          {list(width, height - COMPACT_DETAIL)}
          <CompactDetail row={row} data={screen.data} now={ctx.now} width={width} />
        </Box>
      );
    } else {
      body = list(width);
    }
  }
  return (
    <Box width={width} height={height} flexDirection="row" flexShrink={0}>
      {body}
    </Box>
  );
}
