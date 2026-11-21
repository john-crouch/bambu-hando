// ABOUTME: The Presets tab's list of BambuStudio filament presets beside (or above) the highlighted preset's detail.
// ABOUTME: Side by side from 90 columns; below that the detail is a compact panel under the list.

import { basename, dirname } from "node:path";

import { Box } from "ink";

import { tildePath } from "../../../paths.js";
import { type Preset, presetFamily } from "../../../presetEdit.js";
import type { UserPreset } from "../../../syncCheck.js";
import type { Ctx } from "../../core/types.js";
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
import { compactDetail, presetDetail, printerLabel } from "./detail.js";
import { type FileState, type PresetsModel, visiblePresets } from "./model.js";

/** From this many columns the detail panel sits beside the list. */
export const SIDE_BY_SIDE = 90;

/** The compact detail's height under the list, borders included. */
const COMPACT_DETAIL = 9;

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function presetsOf(ctx: Ctx): { presets: UserPreset[]; warnings: string[] } {
  const resource = ctx.resources.presets;
  if (resource.state === "ready") return resource.value;
  if (resource.state === "loading" || resource.state === "failed")
    return resource.previous ?? { presets: [], warnings: [] };
  return { presets: [], warnings: [] };
}

function listRows(model: PresetsModel, rows: UserPreset[], printerWidth: number): ListRow[] {
  return rows.map((preset, index) => {
    const previous = rows[index - 1];
    // Presets of one filament sit together; its name shows once, on the first.
    const repeat =
      previous !== undefined &&
      preset.filamentId !== "" &&
      previous.filamentId === preset.filamentId &&
      previous.name === preset.name;
    return {
      key: preset.path,
      cells: [
        { text: preset.name, grow: true, ...(repeat ? { dim: true } : {}) },
        { text: printerLabel(preset.printer), width: printerWidth, dim: true },
        preset.filamentId
          ? { text: preset.filamentId, width: 8, dim: true }
          : { text: "no ID", width: 8, color: COLORS.warning },
        { text: model.drafts.has(preset.path) ? "edited" : "", width: 6, color: COLORS.warning },
      ],
    };
  });
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
  const rows = visiblePresets(model, ctx);
  const cursor = Math.max(
    0,
    rows.findIndex((p) => p.path === model.path),
  );
  const inner = panelInner(width, height);
  const filtering = model.filter.focused || model.filter.text.value !== "";
  const shownWarnings = warnings.slice(0, 2);
  const listHeight = Math.max(
    1,
    inner.height - (filtering ? 2 : 0) - (shownWarnings.length ? shownWarnings.length + 1 : 0),
  );
  const printerWidth = Math.min(
    22,
    Math.max(0, ...presets.map((p) => textWidth(printerLabel(p.printer)))),
  );
  const subtitle = model.filter.text.value
    ? `${rows.length} of ${presets.length}`
    : `${presets.length} in folder ${ctx.values.presetFolder.trim() || "default"}`;
  return (
    <Panel
      title="Presets"
      subtitle={subtitle}
      focused
      width={width}
      height={height}
      footerRight={listPosition(cursor, rows.length)}
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
      {rows.length === 0 ? (
        <Line
          segments={[{ text: " No preset has every word of the filter", color: COLORS.muted }]}
          width={inner.width}
        />
      ) : (
        <List
          rows={listRows(model, rows, printerWidth)}
          cursor={cursor}
          height={listHeight}
          width={inner.width}
          highlight={model.filter.text.value}
          focused={!model.filter.focused}
        />
      )}
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

/** The rows under the swatch: identity, settings, file and the presets sharing the filament ID. */
function detailRows(
  preset: UserPreset,
  file: Preset,
  family: UserPreset[],
  drafted: number,
  compact: boolean,
): DetailRow[] {
  const id: DetailRow = preset.filamentId
    ? { label: "Filament ID", value: preset.filamentId, dim: true }
    : { label: "Filament ID", value: "none: the Check tab gives it one", tone: "warning" };
  const shared: DetailRow[] = family.map((other, index) => ({
    label: index === 0 ? "Same ID" : "",
    value: printerLabel(other.printer) || other.name,
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
      id,
      ...compactDetail(file),
      {
        label: "Same ID",
        value: family.length
          ? family.map((p) => printerLabel(p.printer)).join(", ")
          : "only this one",
        ...(family.length ? {} : { dim: true }),
      },
    ];
  return [
    ...draft,
    ...(draft.length ? [{ label: "", value: "" }] : []),
    { label: "Printer", value: printerLabel(preset.printer) || "any" },
    id,
    color,
    { label: "", value: "" },
    ...presetDetail(file).rows,
    { label: "", value: "" },
    { label: "File", value: basename(preset.path), dim: true },
    { label: "Folder", value: FOLDER, dim: true },
    ...(shared.length ? shared : [{ label: "Same ID", value: "only this one", dim: true }]),
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
  const preset = visiblePresets(model, ctx).find((p) => p.path === model.path);
  if (!preset) return <Panel title="Preset" width={width} height={height} />;
  const file = model.files.get(preset.path);
  const family = presetFamily(presetsOf(ctx).presets, preset).slice(1);
  const drafted = model.drafts.get(preset.path)?.size ?? 0;
  const title = compact
    ? `${preset.name}${preset.printer ? ` @ ${printerLabel(preset.printer)}` : ""}`
    : preset.name;
  if (file?.state !== "ready")
    return (
      <Panel title={title} width={width} height={height}>
        <FileStatus file={file} width={inner.width} />
      </Panel>
    );
  const swatch = presetDetail(file.preset).swatch;
  const listed = detailRows(preset, file.preset, family, drafted, compact);
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
            action={{ keys: "ctrl+k", label: "reload presets" }}
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
            action={{ keys: "tab", label: "go to another tab" }}
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
