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
  fitText,
  ICONS,
  Line,
  List,
  type ListRow,
  PageBar,
  Panel,
  panelInner,
  type Segment,
  truncate,
} from "../../ui/index.js";
import type { CheckModel, IdsPage } from "./model.js";
import {
  checkHeadline,
  checkLayout,
  checkView,
  idsLayout,
  itemRows,
  PAD,
  SHORT_TITLES,
  sectionRows,
  warningLines,
  whyLines,
} from "./report.js";

const TONE_COLOR = { ok: COLORS.ok, problem: COLORS.failed, note: COLORS.warning } as const;
const TONE_ICON = { ok: ICONS.ok, problem: ICONS.failed, note: ICONS.warning } as const;

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** An item as people read it: printers without the vendor, as everywhere else in the TUI. */
function shownItem(item: string): string {
  return item.replaceAll("Bambu Lab ", "");
}

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

function Headline({ model: _model, ctx, data }: { model: CheckModel; ctx: Ctx; data: CheckData }) {
  const view = checkView(ctx);
  const width = ctx.bodyColumns;
  const headline = checkHeadline(data.sections, ctx);
  const compared: Segment = { text: `  ${headline.compared}`, color: COLORS.muted };
  if (view.kind === "loading")
    return (
      <Box width={width} height={1} flexShrink={0} paddingLeft={PAD}>
        <Busy message={`Checking again… ${headline.compared}`} />
      </Box>
    );
  const first: Segment[] =
    view.kind === "failed"
      ? [
          { text: `${ICONS.failed} Couldn't check again: ${view.error}`, color: COLORS.failed },
          { text: " · showing the last check", color: COLORS.muted },
        ]
      : [
          {
            text: `${TONE_ICON[headline.tone]} ${headline.text}`,
            color: TONE_COLOR[headline.tone],
            bold: true,
          },
          compared,
        ];
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Line segments={pad(first)} width={width} />
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

function sectionListRows(sections: CheckSection[]): ListRow[] {
  return sectionRows(sections).map((row) => ({
    key: row.key,
    cells: [
      { text: TONE_ICON[row.tone], width: 1, color: TONE_COLOR[row.tone] },
      { text: SHORT_TITLES[row.key], grow: true, ...(row.tone === "ok" ? { dim: true } : {}) },
      {
        text: String(row.count),
        width: 3,
        align: "right" as const,
        ...(row.tone === "ok" ? { dim: true } : { color: TONE_COLOR[row.tone] }),
      },
    ],
  }));
}

function Report({ model, ctx, data }: { model: CheckModel; ctx: Ctx; data: CheckData }) {
  const layout = checkLayout(ctx, data);
  const leftInner = panelInner(layout.left, layout.height);
  const rightInner = panelInner(layout.right, layout.height);
  const section = data.sections[model.section];
  const items = section?.items ?? [];
  const shown = section ? itemRows(ctx, data, section) : 0;
  const visible = items.slice(model.scroll, model.scroll + shown);
  const position =
    items.length > shown
      ? `${model.scroll + 1}–${model.scroll + visible.length} of ${items.length}`
      : "";
  const tone = section ? (items.length === 0 ? "ok" : section.problem ? "problem" : "note") : "ok";
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Headline model={model} ctx={ctx} data={data} />
      <Box flexDirection="row" flexShrink={0}>
        <Panel
          title="Sections"
          focused={model.focus === "sections"}
          width={layout.left}
          height={layout.height}
        >
          <List
            rows={sectionListRows(data.sections)}
            cursor={model.section}
            height={leftInner.height}
            width={leftInner.width}
            focused={model.focus === "sections"}
          />
          {leftInner.height >= data.sections.length + 4 ? (
            <>
              {Array.from({ length: leftInner.height - data.sections.length - 3 }, (_, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: blank filler lines.
                <Line key={`gap${index}`} segments={[]} width={leftInner.width} />
              ))}
              <Line
                segments={pad([
                  { text: `${ICONS.failed} `, color: COLORS.failed },
                  { text: "spools lose their preset", color: COLORS.muted },
                ])}
                width={leftInner.width}
              />
              <Line
                segments={pad([
                  { text: `${ICONS.warning} `, color: COLORS.warning },
                  { text: "worth knowing", color: COLORS.muted },
                ])}
                width={leftInner.width}
              />
            </>
          ) : null}
        </Panel>
        <Panel
          title={section?.title ?? ""}
          subtitle={
            items.length === 0
              ? "none"
              : `${plural(items.length, tone === "problem" ? "problem" : "note")}`
          }
          focused={model.focus === "items"}
          width={layout.right}
          height={layout.height}
          {...(position ? { footerRight: position } : {})}
        >
          {section
            ? whyLines(ctx, data, section).map((line) => (
                <Line
                  key={line}
                  segments={pad([{ text: line, color: COLORS.muted }])}
                  width={rightInner.width}
                />
              ))
            : null}
          <Line segments={[]} width={rightInner.width} />
          {items.length === 0 ? (
            <Line
              segments={pad([{ text: `${ICONS.ok} Nothing here`, color: COLORS.ok }])}
              width={rightInner.width}
            />
          ) : (
            visible.map((item, index) => (
              <Line
                // biome-ignore lint/suspicious/noArrayIndexKey: an item's position in the section is its identity; items can repeat text.
                key={model.scroll + index}
                segments={pad([{ text: shownItem(item) }])}
                width={rightInner.width}
              />
            ))
          )}
        </Panel>
      </Box>
    </Box>
  );
}

/** The review's columns: the file (the rest), its new ID, and the write's result. */
function idColumns(width: number): { file: number; id: number; result: number } {
  const id = 11;
  const result = Math.min(36, Math.floor(width * 0.4));
  return { file: Math.max(8, width - 2 * PAD - id - result - 2), id, result };
}

function headerSegments(width: number): Segment[] {
  const columns = idColumns(width);
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
  const columns = idColumns(width);
  const status: Segment = !result
    ? { text: "" }
    : result.ok
      ? { text: `${ICONS.ok} written`, color: COLORS.ok }
      : {
          text: truncate(`${ICONS.failed} ${result.detail}`, columns.result),
          color: COLORS.failed,
        };
  return pad([
    { text: `${fitText(basename(fix.path), columns.file)} ` },
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
  const position =
    ids.fixes.length > layout.rows
      ? `${ids.scroll + 1}–${ids.scroll + shown.length} of ${ids.fixes.length}`
      : "";
  const pages = [
    { id: "report", title: "Sync check", state: "done" as const },
    { id: "ids", title: "Filament IDs", state: "current" as const },
  ];
  return (
    <Box flexDirection="column" flexShrink={0}>
      <PageBar pages={pages} width={ctx.bodyColumns} />
      <Panel
        title={`Give ${plural(ids.fixes.length, "preset")} a filament ID`}
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
        <Line segments={headerSegments(inner.width)} width={inner.width} />
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
                ? [
                    { text: "Nothing is written until you press ", color: COLORS.muted },
                    { text: "a", color: COLORS.accent2, bold: true },
                  ]
                : failed
                  ? [
                      {
                        text: `${ICONS.failed} ${plural(written, "preset")} given an ID, ${failed} failed`,
                        color: COLORS.failed,
                        bold: true,
                      },
                    ]
                  : [
                      {
                        text: `${ICONS.ok} ${plural(written, "preset")} given an ID`,
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
          "Set up the console in Settings, or turn Skip SpoolEase off.",
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
        lines={[view.error ?? ""]}
        action={{ keys: "r", label: "check again" }}
      />
    );
  return (
    <Centered width={width} height={height}>
      <Busy message="Comparing BambuStudio presets with SpoolEase…" />
    </Centered>
  );
}
