// ABOUTME: The Check tab's screen: a headline, the check's sections beside the highlighted one's why and items, and
// ABOUTME: the filament ID review; empty, loading and failed states in the panel that needs the check.

import { basename } from "node:path";

import { Box } from "ink";
import type { ReactNode } from "react";

import type { CheckSection } from "../../../syncCheck.js";
import type { CheckData, Ctx } from "../../core/types.js";
import {
  Busy,
  COLORS,
  Empty,
  fitPath,
  fitText,
  ICONS,
  Line,
  List,
  type ListRow,
  listPosition,
  Panel,
  panelInner,
  plural,
  type Segment,
  textWidth,
  truncate,
} from "../../ui/index.js";
import { consoleProblem } from "../settings/connection.js";
import type { CheckModel, IdsPage } from "./model.js";
import {
  checkHeadline,
  checkLayout,
  checkView,
  fixCount,
  type ItemView,
  idsLayout,
  itemCount,
  itemRows,
  itemsTitle,
  itemViews,
  needsConsole,
  offlineLines,
  PAD,
  sectionRows,
  sectionTitles,
  warningLines,
  whyLines,
} from "./report.js";

const TONE_COLOR = {
  ok: COLORS.ok,
  problem: COLORS.failed,
  note: COLORS.warning,
  offline: COLORS.muted,
} as const;
const TONE_ICON = {
  ok: ICONS.ok,
  problem: ICONS.failed,
  note: ICONS.warning,
  offline: "–",
} as const;

const pad = (segments: Segment[]): Segment[] => [{ text: " ".repeat(PAD) }, ...segments];

/** The lines a pane of this size shows in the middle: a busy or empty state. */
function Centered({
  width,
  height,
  children,
}: {
  width: number;
  height: number;
  children: ReactNode;
}) {
  return (
    <Box width={width} height={height} justifyContent="center" alignItems="center" flexShrink={0}>
      {children}
    </Box>
  );
}

function headlineSegments(ctx: Ctx, data: CheckData): Segment[] {
  const view = checkView(ctx);
  const headline = checkHeadline(data.sections, ctx);
  const compared: Segment = { text: ` · ${headline.compared}`, color: COLORS.muted };
  if (view.offline)
    return [
      { text: `${ICONS.failed} Couldn't check the console`, color: COLORS.failed, bold: true },
      { text: " · BambuStudio presets only", color: COLORS.muted },
    ];
  if (view.kind === "failed")
    return [
      { text: `${ICONS.failed} Couldn't check again: ${view.error}`, color: COLORS.failed },
      { text: " · showing the last check", color: COLORS.muted },
    ];
  const counts: Segment = {
    text: `${headline.tone === "ok" ? ICONS.ok : ICONS.failed} ${headline.text}`,
    color: headline.tone === "ok" ? COLORS.ok : COLORS.failed,
    bold: true,
  };
  // What was compared goes whole or not at all: a URL cut in the middle says nothing.
  const fits = PAD + textWidth(counts.text) + textWidth(compared.text) <= ctx.bodyColumns;
  return fits ? [counts, compared] : [counts];
}

function Headline({ ctx, data }: { ctx: Ctx; data: CheckData }) {
  const view = checkView(ctx);
  const width = ctx.bodyColumns;
  if (view.kind === "loading")
    return (
      <Box width={width} height={1} flexShrink={0} paddingLeft={PAD}>
        <Busy message={`Checking again… ${checkHeadline(data.sections, ctx).compared}`} />
      </Box>
    );
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Line segments={pad(headlineSegments(ctx, data))} width={width} />
      {warningLines(data.warnings).map((warning) => (
        <Line
          key={warning}
          segments={pad([{ text: `${ICONS.warning} ${warning}`, color: COLORS.warning }])}
          width={width}
        />
      ))}
    </Box>
  );
}

function sectionListRows(ctx: Ctx, sections: CheckSection[], offline: boolean): ListRow[] {
  const titles = sectionTitles(ctx);
  return sectionRows(sections, offline).map((row) => {
    const quiet = row.tone === "ok" || row.tone === "offline";
    return {
      key: row.key,
      cells: [
        { text: TONE_ICON[row.tone], width: 1, color: TONE_COLOR[row.tone] },
        { text: titles[row.key], grow: true, ...(quiet ? { dim: true } : {}) },
        {
          text: row.tone === "offline" ? "–" : String(row.count),
          width: 3,
          align: "right" as const,
          ...(quiet ? { dim: true } : { color: TONE_COLOR[row.tone] }),
        },
      ],
    };
  });
}

/** The legend under the sections, long where it fits; none where the list needs the rows. */
function legendLines(width: number, rows: number, offline: boolean): Segment[][] {
  const long = width >= 2 * PAD + 2 + textWidth("spools lose their preset");
  const entries: [string, string, string][] = [
    [ICONS.failed, COLORS.failed, long ? "spools lose their preset" : "problem"],
    [ICONS.warning, COLORS.warning, long ? "worth knowing" : "note"],
    ...(offline ? [["–", COLORS.muted, "not checked"] as [string, string, string]] : []),
  ];
  if (rows < entries.length + 1) return [];
  return entries.map(([icon, color, text]) =>
    pad([
      { text: `${icon} `, color },
      { text, color: COLORS.muted },
    ]),
  );
}

/** Which of an item's columns to show: the name keeps its whole width before codes, then printers, go. */
function itemColumns(items: readonly ItemView[], width: number) {
  const widest = (pick: (item: ItemView) => string | undefined) =>
    Math.max(0, ...items.map((item) => textWidth(pick(item) ?? "")));
  const spool = widest((item) => (item.spool ? `#${item.spool}` : undefined));
  const name = widest((item) => item.name);
  let printers = widest((item) => item.printers);
  let code = widest((item) => item.code);
  const total = () =>
    [spool, name, printers, code]
      .filter((w) => w > 0)
      .reduce((sum, w, i) => sum + w + (i ? 1 : 0), 0);
  if (total() > width) code = 0;
  if (total() > width) printers = 0;
  return { spool, printers, code };
}

function itemListRows(items: readonly ItemView[], width: number): ListRow[] {
  // The list's gutter and its scroll column.
  const columns = itemColumns(items, width - 2);
  return items.map((item, index) => ({
    key: `${index}`,
    cells: [
      ...(columns.spool
        ? [{ text: item.spool ? `#${item.spool}` : "", width: columns.spool, dim: true }]
        : []),
      { text: item.name, grow: true },
      ...(columns.printers
        ? [{ text: item.printers ?? "", width: columns.printers, color: COLORS.muted }]
        : []),
      ...(columns.code ? [{ text: item.code ?? "", width: columns.code, dim: true }] : []),
    ],
  }));
}

function Report({ model, ctx, data }: { model: CheckModel; ctx: Ctx; data: CheckData }) {
  const view = checkView(ctx);
  const offline = Boolean(view.offline);
  const layout = checkLayout(ctx, data, model.focus);
  const leftInner = panelInner(layout.left, layout.height);
  const rightInner = panelInner(layout.right, layout.height);
  const section = data.sections[model.section];
  const notChecked = Boolean(offline && section && needsConsole(section.key));
  const items = section && !notChecked ? itemViews(section, data) : [];
  const shown = section ? itemRows(ctx, data, section, model.focus) : 0;
  const position = items.length > shown ? listPosition(model.item, items.length) : "";
  const heading = section
    ? itemsTitle(
        ctx,
        section,
        notChecked ? ["not checked", ""] : itemCount(section, items),
        layout.right,
      )
    : { title: "", subtitle: "" };
  const offlineText = notChecked ? offlineLines(ctx, data, view.error ?? "") : null;
  const legend = legendLines(leftInner.width, leftInner.height - data.sections.length - 1, offline);
  const explain = offlineText
    ? [
        ...offlineText.error.map((line) => pad([{ text: line, color: COLORS.failed }])),
        [],
        ...offlineText.advice.map((line) => pad([{ text: line, color: COLORS.muted }])),
      ]
    : section
      ? whyLines(ctx, data, section, model.focus).map((line) =>
          pad([{ text: line, color: COLORS.muted }]),
        )
      : [];
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Headline ctx={ctx} data={data} />
      <Box flexDirection="row" flexShrink={0}>
        {layout.left > 0 ? (
          <Panel
            title="Sections"
            focused={model.focus === "sections"}
            width={layout.left}
            height={layout.height}
          >
            <List
              rows={sectionListRows(ctx, data.sections, offline)}
              cursor={model.section}
              height={Math.min(leftInner.height, data.sections.length)}
              width={leftInner.width}
              focused={model.focus === "sections"}
            />
            {legend.length ? (
              <>
                {Array.from(
                  { length: leftInner.height - data.sections.length - legend.length },
                  (_, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: blank filler lines.
                    <Line key={`gap${index}`} segments={[]} width={leftInner.width} />
                  ),
                )}
                {legend.map((segments, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: the legend's lines, in order.
                  <Line key={`legend${index}`} segments={segments} width={leftInner.width} />
                ))}
              </>
            ) : null}
          </Panel>
        ) : null}
        <Panel
          title={heading.title}
          subtitle={heading.subtitle}
          focused={model.focus === "items"}
          width={layout.right}
          height={layout.height}
          {...(position ? { footerRight: position } : {})}
        >
          {explain.map((segments, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: wrapped lines, in order.
            <Line key={index} segments={segments} width={rightInner.width} />
          ))}
          <Line segments={[]} width={rightInner.width} />
          {notChecked ? null : items.length === 0 ? (
            <Line
              segments={pad([{ text: `${ICONS.ok} Nothing here`, color: COLORS.ok }])}
              width={rightInner.width}
            />
          ) : (
            <List
              rows={itemListRows(items, rightInner.width)}
              cursor={model.item}
              height={shown}
              width={rightInner.width}
              focused={model.focus === "items"}
            />
          )}
        </Panel>
      </Box>
    </Box>
  );
}

/** The review's columns: the file (the rest), its new ID, and the results' room once there are any. */
function idColumns(width: number, ids: IdsPage): { file: number; id: number; result: number } {
  const id = 11;
  const widest = Math.max(
    0,
    ...(ids.results ?? []).map((r) =>
      textWidth(r.ok ? `${ICONS.ok} written` : `${ICONS.failed} ${r.detail}`),
    ),
  );
  const result = Math.min(widest, 36, Math.floor(width * 0.4));
  return { file: Math.max(8, width - 2 * PAD - id - 1 - (result ? result + 1 : 0)), id, result };
}

function headerSegments(width: number, ids: IdsPage): Segment[] {
  const columns = idColumns(width, ids);
  return pad([
    { text: `${fitText("Preset file", columns.file)} `, color: COLORS.muted },
    { text: `${fitText("Filament ID", columns.id)} `, color: COLORS.muted },
  ]);
}

function resultSegments(
  fix: IdsPage["fixes"][number],
  index: number,
  ids: IdsPage,
  width: number,
): Segment[] {
  const result = ids.results?.[index];
  const columns = idColumns(width, ids);
  const status: Segment = !result
    ? { text: "" }
    : result.ok
      ? { text: `${ICONS.ok} written`, color: COLORS.ok }
      : {
          text: truncate(`${ICONS.failed} ${result.detail}`, columns.result),
          color: COLORS.failed,
        };
  return pad([
    { text: `${fitText(fitPath(basename(fix.path), columns.file), columns.file)} ` },
    { text: `${fitText(fix.id, columns.id)} `, color: COLORS.accent2, bold: true },
    status,
  ]);
}

function IdsReview({ ids, ctx }: { ids: IdsPage; ctx: Ctx }) {
  const layout = idsLayout(ctx);
  const inner = panelInner(ctx.bodyColumns, layout.height);
  const shown = ids.fixes.slice(ids.scroll, ids.scroll + layout.rows);
  const failed = ids.results?.filter((r) => !r.ok).length ?? 0;
  const written = (ids.results?.length ?? 0) - failed;
  const presets = new Set(ids.fixes.map((fix) => fix.name)).size;
  const position =
    ids.fixes.length > layout.rows
      ? `${ids.scroll + 1}–${ids.scroll + shown.length} of ${ids.fixes.length}`
      : "";
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Panel
        title={`Give ${plural(presets, "preset")} a filament ID`}
        subtitle={`BambuStudio ${ctx.values.presetFolder.trim()}`}
        focused
        width={ctx.bodyColumns}
        height={layout.height}
        {...(position ? { footerRight: position } : {})}
      >
        {layout.intro.map((line) => (
          <Line
            key={line}
            segments={pad([{ text: line, color: COLORS.muted }])}
            width={inner.width}
          />
        ))}
        <Line segments={[]} width={inner.width} />
        <Line segments={headerSegments(inner.width, ids)} width={inner.width} />
        {shown.map((fix, offset) => (
          <Line
            key={fix.path}
            segments={resultSegments(fix, ids.scroll + offset, ids, inner.width)}
            width={inner.width}
          />
        ))}
        {Array.from({ length: layout.rows - shown.length }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: blank filler lines.
          <Line key={`gap${index}`} segments={[]} width={inner.width} />
        ))}
        <Line segments={[]} width={inner.width} />
        {ids.running ? (
          <Box paddingLeft={PAD} height={1}>
            <Busy message="Writing presets…" />
          </Box>
        ) : (
          <Line
            segments={pad(
              ids.results === null
                ? [{ text: `${fixCount(ids.fixes)} to write`, color: COLORS.muted }]
                : failed
                  ? [
                      {
                        text: written
                          ? `${ICONS.failed} ${plural(written, "file")} given an ID, ${failed} failed`
                          : `${ICONS.failed} ${plural(failed, "file")} not given an ID`,
                        color: COLORS.failed,
                        bold: true,
                      },
                    ]
                  : [
                      {
                        text: `${ICONS.ok} ${plural(presets, "preset")} given an ID`,
                        color: COLORS.ok,
                        bold: true,
                      },
                    ],
            )}
            width={inner.width}
          />
        )}
        <Line segments={[]} width={inner.width} />
        {layout.note.map((line) => (
          <Line
            key={line}
            segments={pad([{ text: line, color: COLORS.muted }])}
            width={inner.width}
          />
        ))}
      </Panel>
    </Box>
  );
}

export function CheckView({ model, ctx }: { model: CheckModel; ctx: Ctx }) {
  const view = checkView(ctx);
  const width = ctx.bodyColumns;
  const height = ctx.bodyRows;
  if (model.page === "ids" && model.ids) return <IdsReview ids={model.ids} ctx={ctx} />;
  if (view.kind === "none")
    return (
      <Empty
        width={width}
        height={height}
        title="No SpoolEase console to check against"
        lines={[
          "The check compares BambuStudio's presets with the console's",
          "custom filaments and spools, and lists what doesn't line up.",
          "Set up the console in Settings, or turn Use SpoolEase on.",
        ]}
        action={{ keys: "enter", label: "open Settings" }}
      />
    );
  if (view.data) return <Report model={model} ctx={ctx} data={view.data} />;
  if (view.kind === "failed")
    return (
      <Empty
        width={width}
        height={height}
        title="Couldn't check"
        lines={[view.error ?? "", consoleProblem(view.error ?? "").advice]}
      />
    );
  return (
    <Centered width={width} height={height}>
      <Busy message="Comparing BambuStudio presets with SpoolEase…" />
    </Centered>
  );
}
