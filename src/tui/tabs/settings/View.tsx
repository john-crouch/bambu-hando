// ABOUTME: The Settings tab's screen: a page bar, the page's rows (a text field in place while one is edited), and beside
// ABOUTME: them the highlighted row's explanation and value, the list it opened, or the connection test's result.

import { Box } from "ink";

import { LABEL_FIELDS } from "../../../labels.js";
import type { Ctx } from "../../core/types.js";
import {
  Busy,
  COLORS,
  fitText,
  ICONS,
  Line,
  List,
  type ListRow,
  listPosition,
  type Page,
  PageBar,
  Panel,
  panelInner,
  type Segment,
  TextField,
  textWidth,
} from "../../ui/index.js";
import { connectionOf, printerLabel, printerList, validPort } from "./connection.js";
import {
  fieldKind,
  labelFieldName,
  listFor,
  PAGE_FIELDS,
  PAGES,
  type PageId,
  PLACEHOLDERS,
  pageRows,
  type SettingRow,
  shownItems,
} from "./fields.js";
import { listRows, settingsLayout } from "./layout.js";
import type { SettingsModel } from "./model.js";
import { wrapText } from "./wrap.js";

/** Margin inside a panel. */
const PAD = 1;
const GAP = 2;

const pad = (segments: Segment[]): Segment[] => [{ text: " ".repeat(PAD) }, ...segments];

/** How a page's changes last, in its panel's bottom border. */
const PAGE_NOTES: Record<PageId, string> = {
  bambu: "applies at once",
  spoolease: "applies at once",
  labels: "saved for next time",
  import: "applies at once",
};

/** A page wants attention: printers missing, or SpoolEase on without a usable console. */
function pageBadge(page: PageId, ctx: Ctx): string | undefined {
  const values = ctx.values;
  if (page === "bambu" && printerList(values.printerPreset).length === 0) return ICONS.warning;
  if (page === "spoolease" && !values.skipSpoolease && !connectionOf(values)) return ICONS.warning;
  return undefined;
}

function pages(model: SettingsModel, ctx: Ctx): Page[] {
  return PAGES.map((page) => {
    const badge = pageBadge(page.id, ctx);
    return {
      id: page.id,
      title: page.title,
      state: page.id === model.page ? "current" : "todo",
      ...(badge ? { badge } : {}),
    };
  });
}

function valueSegment(row: SettingRow, selected: boolean): Segment {
  const strong = selected ? { bold: true } : {};
  if (row.kind === "toggle")
    return row.on
      ? { text: `${ICONS.ok} on`, color: COLORS.ok, ...strong }
      : { text: "off", color: COLORS.muted };
  if (row.tone === "warning") return { text: row.value, color: COLORS.warning, ...strong };
  return {
    text: row.value,
    ...(selected ? { color: COLORS.selectionText, bold: true } : {}),
  };
}

function rowSegments(
  row: SettingRow,
  width: number,
  labelWidth: number,
  selected: boolean,
  focused: boolean,
): Segment[] {
  const bar = selected ? { backgroundColor: focused ? COLORS.selection : "#2A2633" } : {};
  const dim = row.dim ? { dim: true } : {};
  const gutter: Segment =
    selected && focused ? { text: "▌", color: COLORS.accent, ...bar } : { text: " ", ...bar };
  const label: Segment = {
    text: fitText(row.label, labelWidth + GAP),
    color: selected && focused ? COLORS.selectionText : COLORS.muted,
    ...bar,
    ...dim,
  };
  const room = Math.max(0, width - 1 - labelWidth - GAP - PAD);
  const value = valueSegment(row, selected && focused);
  return [
    gutter,
    label,
    { ...value, text: fitText(value.text, room), ...bar, ...dim },
    { text: " ".repeat(PAD), ...bar },
  ];
}

function RowsPanel({ model, ctx }: { model: SettingsModel; ctx: Ctx }) {
  const layout = settingsLayout(ctx, model.page);
  const inner = panelInner(layout.left, layout.rowsHeight);
  const rows = pageRows(model.page, ctx, model);
  const labelWidth = Math.max(...PAGE_FIELDS[model.page].map((f) => textWidth(f.label)));
  const cursor = model.cursors[model.page];
  const open = model.open;
  const focused = open?.kind !== "list";
  const title = PAGES.find((p) => p.id === model.page)?.title ?? "";
  return (
    <Panel
      title={title}
      focused={focused}
      width={layout.left}
      height={layout.rowsHeight}
      footerRight={PAGE_NOTES[model.page]}
    >
      {/* Side by side there's room for air above the rows; stacked, the detail needs the line. */}
      {layout.stacked ? null : <Line segments={[]} width={inner.width} />}
      {rows.map((row, index) => {
        if (open?.kind === "text" && index === cursor) {
          const prefix = 1 + labelWidth + GAP;
          const placeholder = PLACEHOLDERS[row.field];
          return (
            <Box key={row.field} flexDirection="row" flexShrink={0}>
              <Line
                segments={[
                  { text: "▌", color: COLORS.accent },
                  { text: fitText(row.label, labelWidth + GAP), color: COLORS.accent, bold: true },
                ]}
                width={prefix}
              />
              <TextField
                value={open.value}
                cursor={open.cursor}
                focused
                width={Math.max(1, inner.width - prefix - PAD)}
                {...(row.kind === "secret" ? { mask: true } : {})}
                {...(placeholder ? { placeholder } : {})}
              />
            </Box>
          );
        }
        return (
          <Line
            key={row.field}
            segments={rowSegments(row, inner.width, labelWidth, index === cursor, focused)}
            width={inner.width}
          />
        );
      })}
    </Panel>
  );
}

function wrapped(text: string, width: number, style: Omit<Segment, "text">): Segment[][] {
  return wrapText(text, width - 2 * PAD).map((line) => pad([{ text: line, ...style }]));
}

/** What the highlighted row's value is made of, where it's more than its one line. */
function valueLines(model: SettingsModel, ctx: Ctx, row: SettingRow, width: number): Segment[][] {
  const tick = (text: string): Segment[] =>
    pad([{ text: `${ICONS.ticked} `, color: COLORS.ok }, { text: text }]);
  if (row.field === "printerPreset") {
    const printers = printerList(ctx.values.printerPreset);
    return printers.length
      ? printers.map((p) => tick(printerLabel(p)))
      : wrapped("No printer: tick at least one, or Add can't write presets.", width, {
          color: COLORS.warning,
        });
  }
  if (row.field === "labelFields") {
    const fields = model.labels.value?.fields ?? [];
    return LABEL_FIELDS.filter((f) => fields.includes(f.key)).map((f) =>
      tick(labelFieldName(f.key)),
    );
  }
  if (row.field === "port" && validPort(ctx.values.port) === null)
    return wrapped("Not a port: give a whole number from 1 to 65535.", width, {
      color: COLORS.warning,
    });
  return [];
}

function connectionLines(model: SettingsModel, ctx: Ctx, width: number): Segment[][] {
  const lines: Segment[][] = [[], pad([{ text: "Connection", bold: true }])];
  if (ctx.values.skipSpoolease)
    lines.push(
      ...wrapped("SpoolEase is skipped: runs write BambuStudio presets only.", width, {
        color: COLORS.warning,
      }),
    );
  const test = model.test;
  if (test.state === "ok")
    lines.push(...wrapped(`${ICONS.ok} ${test.text}`, width, { color: COLORS.ok }));
  else if (test.state === "failed")
    lines.push(...wrapped(`${ICONS.failed} ${test.text}`, width, { color: COLORS.failed }));
  else if (test.state === "idle")
    lines.push(
      pad([
        { text: "t", color: COLORS.accent2, bold: true },
        { text: " tests the connection", color: COLORS.muted },
      ]),
    );
  return lines;
}

function SideLines({ lines, width }: { lines: Segment[][]; width: number }) {
  return (
    <>
      {lines.map((segments, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional lines built per render.
        <Line key={index} segments={segments} width={width} />
      ))}
    </>
  );
}

function errorLines(error: string, width: number): Segment[][] {
  return error ? [[], ...wrapped(`${ICONS.failed} ${error}`, width, { color: COLORS.failed })] : [];
}

function ListPanel({ model, ctx }: { model: SettingsModel; ctx: Ctx }) {
  const open = model.open;
  if (open?.kind !== "list") return null;
  const layout = settingsLayout(ctx, model.page);
  const inner = panelInner(layout.right, layout.sideHeight);
  const list = listFor(open.field, ctx, model);
  const items = shownItems(list, open);
  const row = pageRows(model.page, ctx, model).find((r) => r.field === open.field);
  const rows: ListRow[] = items.map((item) => ({
    key: item.value,
    ticked: list.ticked.includes(item.value),
    cells: [
      { text: item.label, grow: true },
      ...(item.detail ? [{ text: item.detail, dim: true }] : []),
    ],
  }));
  const filtered = open.filter !== undefined;
  const height = listRows(ctx, model.page, filtered);
  const foot: Segment[][] = model.error
    ? errorLines(model.error, inner.width)
    : list.note
      ? [[], ...wrapped(list.note, inner.width, { color: COLORS.warning })]
      : [];
  return (
    <Panel
      title={row?.label ?? ""}
      subtitle={list.multi ? `${list.ticked.length} ticked` : "choose one"}
      focused
      width={layout.right}
      height={layout.sideHeight}
      {...(items.length > height ? { footerRight: listPosition(open.cursor, items.length) } : {})}
    >
      {filtered ? (
        <Box flexDirection="row" flexShrink={0}>
          <Line
            segments={[{ text: " / ", color: open.filtering ? COLORS.accent : COLORS.muted }]}
            width={3}
          />
          <TextField
            value={open.filter?.value ?? ""}
            cursor={open.filter?.cursor ?? 0}
            focused={Boolean(open.filtering)}
            width={Math.max(1, inner.width - 3 - PAD)}
            placeholder="type to filter"
          />
        </Box>
      ) : null}
      {list.loading && list.items.length === 0 ? (
        <Box paddingLeft={PAD} height={1}>
          <Busy message="Reading…" />
        </Box>
      ) : items.length === 0 ? (
        <Line
          segments={pad([{ text: "Nothing matches the filter", color: COLORS.muted }])}
          width={inner.width}
        />
      ) : (
        <List
          rows={rows}
          cursor={open.cursor}
          height={Math.min(height, rows.length)}
          width={inner.width}
          marker="check"
          {...(open.filter?.value ? { highlight: open.filter.value } : {})}
        />
      )}
      {list.loading && list.items.length > 0 ? (
        <Box paddingLeft={PAD} height={1}>
          <Busy message="Reading…" />
        </Box>
      ) : null}
      <SideLines lines={foot} width={inner.width} />
    </Panel>
  );
}

function DetailPanel({ model, ctx }: { model: SettingsModel; ctx: Ctx }) {
  const layout = settingsLayout(ctx, model.page);
  const inner = panelInner(layout.right, layout.sideHeight);
  const rows = pageRows(model.page, ctx, model);
  const row = rows[model.cursors[model.page]];
  if (!row) return null;
  const editing = model.open?.kind === "text";
  const values = editing ? [] : valueLines(model, ctx, row, inner.width);
  const lines: Segment[][] = [
    ...(layout.stacked ? [] : [[]]),
    ...wrapped(row.detail, inner.width, { color: COLORS.muted }),
    ...(values.length ? [[], ...values] : []),
    ...(editing && fieldKind(row.field) === "secret"
      ? [
          [],
          ...wrapped("Typed as dots; never shown or logged.", inner.width, { color: COLORS.muted }),
        ]
      : []),
    ...errorLines(model.error, inner.width),
    ...(model.page === "spoolease" ? connectionLines(model, ctx, inner.width) : []),
  ];
  const testing = model.page === "spoolease" && model.test.state === "testing";
  return (
    <Panel title={row.label} focused={false} width={layout.right} height={layout.sideHeight}>
      <SideLines lines={lines} width={inner.width} />
      {testing ? (
        <Box paddingLeft={PAD} height={1}>
          <Busy message="Testing the connection…" />
        </Box>
      ) : null}
    </Panel>
  );
}

export function SettingsView({ model, ctx }: { model: SettingsModel; ctx: Ctx }) {
  const { stacked } = settingsLayout(ctx, model.page);
  return (
    <Box flexDirection="column" flexShrink={0}>
      <PageBar pages={pages(model, ctx)} width={ctx.bodyColumns} />
      <Box flexDirection={stacked ? "column" : "row"} flexShrink={0}>
        <RowsPanel model={model} ctx={ctx} />
        {model.open?.kind === "list" ? (
          <ListPanel model={model} ctx={ctx} />
        ) : (
          <DetailPanel model={model} ctx={ctx} />
        )}
      </Box>
    </Box>
  );
}
