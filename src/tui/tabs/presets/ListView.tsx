// ABOUTME: The Presets tab's list of BambuStudio filament presets beside (or above) the highlighted preset's detail.
// ABOUTME: Side by side from 90 columns; below that the detail is a compact panel under the list.

import { basename, dirname } from "node:path";

import { Box } from "ink";

import { tildePath } from "../../../paths.js";
import { type Preset, presetFamily } from "../../../presetEdit.js";
import type { UserPreset } from "../../../syncCheck.js";
import type { Ctx } from "../../core/types.js";
import { plural } from "../../ui/format.js";
import {
  Busy,
  Detail,
  type DetailRow,
  Empty,
  Line,
  List,
  type ListRow,
  labelColumn,
  listPosition,
  Panel,
  panelInner,
  type Segment,
  Swatch,
  splitWidths,
  textWidth,
} from "../../ui/index.js";
import { textFieldSegments } from "../../ui/TextField.js";
import { COLORS, ICONS } from "../../ui/theme.js";
import {
  compactDetail,
  groupKey,
  type ListCells,
  listColumns,
  type PresetGroup,
  presetDetail,
  presetGroups,
  presetTitle,
  printerLabel,
  printersText,
  statusCells,
} from "./detail.js";
import { type FileState, type PresetsModel, visibleGroups } from "./model.js";

/** From this many columns the detail panel sits beside the list. */
export const SIDE_BY_SIDE = 90;

/** The compact detail's height under the list, borders included. */
const COMPACT_DETAIL = 9;

function presetsOf(ctx: Ctx): { presets: UserPreset[]; warnings: string[] } {
  const resource = ctx.resources.presets;
  if (resource.state === "ready") return resource.value;
  if (resource.state === "loading" || resource.state === "failed")
    return resource.previous ?? { presets: [], warnings: [] };
  return { presets: [], warnings: [] };
}

/** How many presets readUserPresets left out for inheriting a system preset. */
function inheritedOf(ctx: Ctx): number {
  const resource = ctx.resources.presets;
  if (resource.state === "ready") return resource.value.inherited ?? 0;
  if (resource.state === "loading" || resource.state === "failed")
    return resource.previous?.inherited ?? 0;
  return 0;
}

/** What a group's row says: its name, printers, whether it has unsaved edits, and its filament ID. */
function groupCells(model: PresetsModel, group: PresetGroup): ListCells {
  return {
    name: group.name,
    printers: group.presets.map((p) => p.printer),
    edited: group.presets.some((p) => model.drafts.has(p.path)),
    id: group.presets[0]?.filamentId ?? "",
  };
}

function listRows(
  model: PresetsModel,
  groups: PresetGroup[],
  width: number,
  scrolls: boolean,
): ListRow[] {
  const cells = groups.map((group) => groupCells(model, group));
  const widths = listColumns(width, cells, scrolls);
  return groups.map((group, index) => {
    const row = cells[index] as ListCells;
    const { status, id } = statusCells(row, widths);
    return {
      key: group.key,
      cells: [
        { text: row.name, width: widths.name },
        ...(widths.printers
          ? [
              {
                text: printersText(row.printers, widths.printers),
                width: widths.printers,
                dim: true,
              },
            ]
          : []),
        ...(widths.status ? [{ text: status, width: widths.status, color: COLORS.warning }] : []),
        ...(widths.id
          ? [
              row.id
                ? { text: id, width: widths.id, dim: true }
                : { text: id, width: widths.id, color: COLORS.warning },
            ]
          : []),
      ],
    };
  });
}

/** The first of the texts that fits width columns, else the last. */
function firstFitting(texts: string[], width: number): string {
  return texts.find((text) => textWidth(text) <= width) ?? (texts.at(-1) as string);
}

/** The list's subtitle: counts and folder, the folder dropped before anything is cut. */
function listSubtitle(filaments: number, presets: number, folder: string, room: number): string {
  const counts = `${plural(filaments, "filament")}${filaments === presets ? "" : ` (${plural(presets, "preset")})`}`;
  return firstFitting([`${counts} in folder ${folder}`, counts], room);
}

/** Says how many presets the list leaves out for inheriting a system one, and where they're edited. */
function inheritedNote(count: number, width: number): string {
  const one = count === 1;
  const more = `${count} more ${one ? "inherits" : "inherit"} a system preset`;
  return firstFitting([`${more}: edit ${one ? "it" : "those"} in BambuStudio`, more], width);
}

function FilterLine({ model, width }: { model: PresetsModel; width: number }) {
  const { text, focused } = model.filter;
  return (
    <Line
      segments={[
        { text: " / ", color: COLORS.accent2, bold: true },
        ...textFieldSegments({
          value: text.value,
          cursor: text.cursor,
          focused,
          placeholder: "name, printer or ID",
          width: Math.max(1, width - 4),
        }),
      ]}
      width={width}
    />
  );
}

function PresetList({
  model,
  ctx,
  width,
  height,
}: {
  model: PresetsModel;
  ctx: Ctx;
  width: number;
  height: number;
}) {
  const { presets, warnings } = presetsOf(ctx);
  const groups = visibleGroups(model, ctx);
  const cursor = Math.max(
    0,
    groups.findIndex((g) => g.presets.some((p) => p.path === model.path)),
  );
  const inner = panelInner(width, height);
  const filtering = model.filter.focused || model.filter.text.value !== "";
  const shownWarnings = warnings.slice(0, 2);
  const inherited = inheritedOf(ctx);
  const listHeight = Math.max(
    1,
    inner.height -
      (filtering ? 2 : 0) -
      (shownWarnings.length ? shownWarnings.length + 1 : 0) -
      (inherited ? 1 : 0),
  );
  const filaments = presetGroups(presets, "").length;
  // The top border holds "╭ Presets · ", the subtitle and " ─╮".
  const subtitle = model.filter.text.value
    ? `${groups.length} of ${filaments}`
    : listSubtitle(
        filaments,
        presets.length,
        ctx.values.presetFolder.trim() || "default",
        width - 15,
      );
  return (
    <Panel
      title="Presets"
      subtitle={subtitle}
      focused
      width={width}
      height={height}
      footerRight={listPosition(cursor, groups.length)}
    >
      {shownWarnings.map((warning) => (
        <Line
          key={warning}
          segments={[{ text: ` ${ICONS.warning} ${warning}`, color: COLORS.warning }]}
          width={inner.width}
        />
      ))}
      {shownWarnings.length ? <Line segments={[]} width={inner.width} /> : null}
      {filtering ? <FilterLine model={model} width={inner.width} /> : null}
      {filtering ? <Line segments={[]} width={inner.width} /> : null}
      {groups.length === 0 ? (
        <Box flexDirection="column" height={listHeight} flexShrink={0}>
          <Line
            segments={[{ text: " No preset has every word of the filter", color: COLORS.muted }]}
            width={inner.width}
          />
        </Box>
      ) : (
        // Its own height, so a note under it sits on the panel's last line.
        <Box flexDirection="column" height={listHeight} flexShrink={0}>
          <List
            rows={listRows(model, groups, inner.width, groups.length > listHeight)}
            cursor={cursor}
            height={listHeight}
            width={inner.width}
            highlight={model.filter.text.value}
            focused={!model.filter.focused}
          />
        </Box>
      )}
      {inherited ? (
        <Line
          segments={[
            { text: ` ${inheritedNote(inherited, inner.width - 2)}`, color: COLORS.muted },
          ]}
          width={inner.width}
        />
      ) : null}
    </Panel>
  );
}

/** Stands in for the folder until the value's width is known: it's cut from the left, keeping its end. */
const FOLDER = "\u0000folder";

/** The text cut from the left to width columns, starting with … when cut. */
function truncateStart(text: string, width: number): string {
  if (textWidth(text) <= width) return text;
  let out = "";
  for (const char of [...text].reverse()) {
    if (textWidth(`…${char}${out}`) > width) break;
    out = char + out;
  }
  return `…${out}`;
}

/** The preset's printer; with ‹ › and its place when ←→ pick among the row's printers. */
function printerRow(preset: UserPreset, group: PresetGroup | undefined): DetailRow {
  const short = printerLabel(preset.printer) || "any";
  const count = group?.presets.length ?? 1;
  if (!group || count < 2) return { label: "Printer", value: short };
  const at = group.presets.indexOf(preset) + 1;
  return { label: "Printer", value: `‹ ${short} ›  ${at} of ${count}`, tone: "accent" };
}

/** The rows under the swatch: identity, settings, file and the presets of other rows sharing the filament ID. */
function detailRows(
  preset: UserPreset,
  file: Preset,
  group: PresetGroup | undefined,
  others: UserPreset[],
  drafted: number,
  compact: boolean,
): DetailRow[] {
  const id: DetailRow = preset.filamentId
    ? { label: "Filament ID", value: preset.filamentId, dim: true }
    : { label: "Filament ID", value: "none: f fixes it in Check", tone: "warning" };
  const shared: DetailRow[] = others.map((other, index) => ({
    label: index === 0 ? "Same ID" : "",
    value: presetTitle(other),
  }));
  const swatch = presetDetail(file).swatch;
  const color: DetailRow = swatch
    ? { label: "Color", value: swatch }
    : { label: "Color", value: "none set", dim: true };
  const draft: DetailRow[] = drafted
    ? [{ label: "Unsaved", value: `${plural(drafted, "change")}, enter to go on`, tone: "warning" }]
    : [];
  if (compact)
    return [
      ...draft,
      printerRow(preset, group),
      id,
      ...compactDetail(file),
      ...(others.length
        ? [{ label: "Same ID", value: others.map((p) => presetTitle(p)).join(", ") }]
        : []),
    ];
  return [
    ...draft,
    ...(draft.length ? [{ label: "", value: "" }] : []),
    printerRow(preset, group),
    id,
    color,
    { label: "", value: "" },
    ...presetDetail(file).rows,
    { label: "", value: "" },
    { label: "File", value: basename(preset.path), dim: true },
    { label: "Folder", value: FOLDER, dim: true },
    ...shared,
  ];
}

function FileStatus({ file, width }: { file: FileState | undefined; width: number }) {
  if (file?.state === "failed")
    return (
      <Box flexDirection="column" paddingX={1} width={width}>
        <Line
          segments={[{ text: `${ICONS.failed} ${file.error}`, color: COLORS.failed }]}
          width={width - 2}
        />
      </Box>
    );
  return (
    <Box paddingX={1}>
      <Busy message="Reading the preset…" />
    </Box>
  );
}

function PresetDetail({
  model,
  ctx,
  width,
  height,
  compact,
}: {
  model: PresetsModel;
  ctx: Ctx;
  width: number;
  height: number;
  compact: boolean;
}) {
  const inner = panelInner(width, height);
  const group = visibleGroups(model, ctx).find((g) => g.presets.some((p) => p.path === model.path));
  const preset = group?.presets.find((p) => p.path === model.path);
  if (!preset) return <Panel title="Preset" width={width} height={height} />;
  const file = model.files.get(preset.path);
  const others = presetFamily(presetsOf(ctx).presets, preset)
    .slice(1)
    .filter((p) => groupKey(p) !== groupKey(preset));
  const drafted = model.drafts.get(preset.path)?.size ?? 0;
  const title = preset.name;
  if (file?.state !== "ready")
    return (
      <Panel title={title} width={width} height={height}>
        <FileStatus file={file} width={inner.width} />
      </Panel>
    );
  const swatch = presetDetail(file.preset).swatch;
  const listed = detailRows(preset, file.preset, group, others, drafted, compact);
  // Detail's value column: what's left of the inside after a margin, the labels, a gap and a margin.
  const valueRoom = inner.width - 1 - labelColumn(listed) - 2 - 1;
  const rows = listed.map((row) =>
    row.value === FOLDER
      ? { ...row, value: truncateStart(tildePath(dirname(preset.path)), valueRoom) }
      : row,
  );
  const chip: Segment[] = swatch
    ? [{ text: " " }, { text: "  ", backgroundColor: swatch }, { text: " " }]
    : [];
  if (compact)
    return (
      <Panel title={title} width={width} height={height}>
        <Box flexDirection="row">
          {swatch ? (
            <Box flexDirection="column" width={4} flexShrink={0}>
              <Line segments={chip} width={4} />
              <Line segments={chip} width={4} />
            </Box>
          ) : null}
          <Detail
            rows={rows.slice(0, inner.height)}
            width={inner.width - (swatch ? 4 : 0)}
            labelWidth={11}
          />
        </Box>
      </Panel>
    );
  return (
    <Panel title={title} width={width} height={height}>
      {swatch ? (
        <Box paddingX={1} flexDirection="column">
          <Swatch color={swatch} width={inner.width - 2} height={2} />
          <Line segments={[]} width={inner.width - 2} />
        </Box>
      ) : null}
      <Detail rows={rows.slice(0, inner.height - (swatch ? 3 : 0))} width={inner.width} />
    </Panel>
  );
}

export function ListView({ model, ctx }: { model: PresetsModel; ctx: Ctx }) {
  const width = ctx.bodyColumns;
  const height = ctx.bodyRows;
  const resource = ctx.resources.presets;
  const { presets } = presetsOf(ctx);
  if (presets.length === 0) {
    const folder = ctx.values.presetFolder.trim() || "default";
    const inner = panelInner(width, height);
    return (
      <Panel title="Presets" focused width={width} height={height}>
        {resource.state === "failed" ? (
          <Empty
            title="Couldn't read BambuStudio's presets"
            lines={[resource.error]}
            action={{ keys: "r", label: "reload" }}
            width={inner.width}
            height={inner.height}
          />
        ) : resource.state === "ready" ? (
          <Empty
            title="No filament presets of your own yet"
            lines={[
              `BambuStudio folder: ${folder}`,
              "Presets you make in BambuStudio, or add with the Add tab, show up here.",
            ]}
            action={{ keys: "enter", label: "add one in Add" }}
            width={inner.width}
            height={inner.height}
          />
        ) : (
          <Box paddingX={1} paddingY={1}>
            <Busy message="Reading BambuStudio presets…" />
          </Box>
        )}
      </Panel>
    );
  }
  if (width >= SIDE_BY_SIDE) {
    const [list = 0, detail = 0] = splitWidths(width, [3, 2]);
    return (
      <Box flexDirection="row" width={width} height={height}>
        <PresetList model={model} ctx={ctx} width={list} height={height} />
        <PresetDetail model={model} ctx={ctx} width={detail} height={height} compact={false} />
      </Box>
    );
  }
  const detail = Math.min(COMPACT_DETAIL, Math.max(0, height - 6));
  return (
    <Box flexDirection="column" width={width} height={height}>
      <PresetList model={model} ctx={ctx} width={width} height={height - detail} />
      {detail > 0 ? (
        <PresetDetail model={model} ctx={ctx} width={width} height={detail} compact />
      ) : null}
    </Box>
  );
}
