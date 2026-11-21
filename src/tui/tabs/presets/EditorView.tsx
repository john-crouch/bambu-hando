// ABOUTME: The preset editor's view: a page bar of setting groups, the page's settings, and the changes so far.
// ABOUTME: Embeddable: the host gives it a width and height (the Presets tab's body, a pane of the Add tab's review).

import { Box } from "ink";

import { fitPath, plural } from "../../ui/format.js";
import {
  Detail,
  type DetailRow,
  Line,
  type ListRow,
  labelColumn,
  listPosition,
  listWindow,
  type Page,
  PageBar,
  Panel,
  panelInner,
  type Segment,
  splitWidths,
  textWidth,
} from "../../ui/index.js";
import { rowSegments } from "../../ui/List.js";
import { textFieldSegments } from "../../ui/TextField.js";
import { padSegments, spaces, truncate } from "../../ui/text.js";
import { COLORS, ICONS } from "../../ui/theme.js";
import { printerLabel } from "./detail.js";
import {
  ALL_SETTINGS,
  type EditorModel,
  type EditorRow,
  editorChanges,
  editorCurrentRow,
  editorPages,
  editorRows,
  editorTakes,
  editorTypingHint,
  editorWarning,
  tidyUnits,
} from "./editor.js";

/** Wide enough for the changes beside the settings. */
export const EDITOR_SIDE_MIN = 100;

/** Rows of the panel's inside that aren't settings: page bar, filter line, the gap and the note line. */
const EDITOR_CHROME = 4;

/** Rows of settings the editor shows in a pane this tall (what ↑↓ paging moves by). */
export function editorListRows(height: number): number {
  return Math.max(1, panelInner(0, height).height - EDITOR_CHROME);
}

/** The columns of a settings row: label, value, and (group pages) what it was. */
function columns(model: EditorModel, rows: readonly EditorRow[], width: number) {
  const widest = Math.max(0, ...rows.map((row) => textWidth(row.label)));
  if (model.page === ALL_SETTINGS) {
    // Keys take what they need while the values keep what theirs need, up to 40% of the row.
    const cells = width - 2;
    const values = Math.max(0, ...rows.map((row) => textWidth(row.value)));
    const keep = Math.min(values, Math.floor(cells * 0.4));
    const key = Math.max(12, Math.min(widest, cells - 1 - keep));
    return { label: key, value: 0 };
  }
  // A value gets the width it needs (named nozzle types run long); what it was takes the rest.
  const label = Math.min(widest, 28);
  const values = Math.max(1, ...rows.map((row) => textWidth(row.value)));
  return { label, value: Math.max(1, Math.min(values, width - 2 - label - 2)) };
}

function cellsOf(row: EditorRow, all: boolean, widths: { label: number; value: number }) {
  const value = { text: row.value, ...(row.changed ? { color: COLORS.accent } : {}) };
  if (all)
    return [
      { text: row.label, width: widths.label, ...(row.locked ? { dim: true } : {}) },
      { ...value, grow: true, ...(row.locked && !row.changed ? { dim: true } : {}) },
    ];
  return [
    { text: row.label, width: widths.label },
    { ...value, width: widths.value },
    { text: row.was ? `was ${row.was}` : "", grow: true, dim: true },
  ];
}

/** The value being typed: selected (typing replaces it) as one highlighted run, else a text field. */
function fieldSegments(model: EditorModel, width: number): Segment[] {
  const text = model.text ?? { value: "", cursor: 0 };
  if (model.selected && text.value !== "")
    return [
      {
        text: truncate(text.value, Math.max(1, width - 1)),
        backgroundColor: COLORS.accent,
        color: COLORS.selectionText,
        bold: true,
      },
      { text: " ", inverse: true },
    ];
  return textFieldSegments({ value: text.value, cursor: text.cursor, focused: true, width });
}

/** A number being typed, as a stepper: ‹ 245°C ›, ←→ step it. */
function stepperSegments(model: EditorModel, unit: string, width: number): Segment[] {
  const value = model.text?.value ?? "";
  const tail = unit === "°C" ? unit : unit ? ` ${unit}` : "";
  const room = Math.max(1, width - 4 - textWidth(tail));
  const field = fieldSegments(model, Math.min(room, textWidth(value) + 1));
  // The cursor's cell sits after the value; while selected the unit follows the value at once.
  const shown = model.selected && value !== "" ? field.slice(0, 1) : field;
  return [
    { text: "‹ ", color: COLORS.accent2, bold: true },
    ...shown,
    { text: tail },
    { text: " ›", color: COLORS.accent2, bold: true },
  ];
}

/** The row being typed: its label, then the field (a stepper for numbers) across the rest of the row. */
function typingSegments(
  model: EditorModel,
  row: EditorRow,
  width: number,
  labelWidth: number,
): Segment[] {
  const label = padSegments([{ text: row.label, bold: true }], labelWidth);
  const fieldWidth = Math.max(1, width - 1 - labelWidth - 1 - 1);
  const numeric = row.field?.kind === "int" || row.field?.kind === "decimal";
  return padSegments(
    [
      { text: "▌", color: COLORS.accent },
      ...label,
      { text: " " },
      ...(numeric
        ? stepperSegments(model, row.field?.unit ?? "", fieldWidth)
        : fieldSegments(model, fieldWidth)),
    ],
    width,
  );
}

/** The line under the settings: an error, what's being typed takes, a locked key's reason, or the file. */
function noteSegments(
  model: EditorModel,
  row: EditorRow | undefined,
  narrow: boolean,
  width: number,
): Segment[] {
  if (model.error)
    return [{ text: `${ICONS.failed} ${tidyUnits(model.error)}`, color: COLORS.failed }];
  const warning = editorWarning(model);
  if (warning) return [{ text: `${ICONS.warning} ${warning}`, color: COLORS.warning }];
  const typing = editorTypingHint(model);
  if (typing) return [{ text: typing, color: COLORS.muted }];
  if (row?.locked) return [{ text: `Locked: ${row.locked}`, color: COLORS.muted }];
  if (model.page === ALL_SETTINGS && row?.was)
    return [{ text: `was ${row.was}`, color: COLORS.muted }];
  // Without the side panel, this line is where what a setting takes is said.
  const takes = narrow ? editorTakes(model) : "";
  if (takes) return [{ text: `Takes ${takes}`, color: COLORS.muted }];
  if (model.mode === "planned")
    return [{ text: "The preset the run writes; edits go into it", color: COLORS.muted }];
  return model.path ? [{ text: fitPath(model.path, width), color: COLORS.muted, dim: true }] : [];
}

function FilterLine({ model, width }: { model: EditorModel; width: number }) {
  if (model.page !== ALL_SETTINGS) return <Line segments={[]} width={width} />;
  const { text, focused } = model.filter;
  if (!focused && !text.value)
    return (
      <Line segments={[{ text: " / filter keys", color: COLORS.muted, dim: true }]} width={width} />
    );
  return (
    <Line
      segments={[
        { text: " / ", color: COLORS.accent2, bold: true },
        ...textFieldSegments({
          value: text.value,
          cursor: text.cursor,
          focused,
          placeholder: "words of the key",
          width: Math.max(1, width - 4),
        }),
      ]}
      width={width}
    />
  );
}

function Settings({ model, width, height }: { model: EditorModel; width: number; height: number }) {
  const rows = editorRows(model);
  const all = model.page === ALL_SETTINGS;
  const cursor = Math.min(model.cursors[model.page] ?? 0, Math.max(0, rows.length - 1));
  const widths = columns(model, rows, width);
  const { start, end } = listWindow(cursor, rows.length, height);
  if (rows.length === 0)
    return (
      <Box flexDirection="column" height={height}>
        <Line
          segments={[{ text: " No key has every word of the filter", color: COLORS.muted }]}
          width={width}
        />
      </Box>
    );
  return (
    <Box flexDirection="column" height={height} flexShrink={0}>
      {rows.slice(start, end).map((row, offset) => {
        const index = start + offset;
        const typing = index === cursor && model.text !== null;
        const listRow: ListRow = { key: row.key, cells: cellsOf(row, all, widths) };
        return (
          <Line
            key={row.key}
            width={width}
            segments={
              typing
                ? typingSegments(model, row, width, widths.label)
                : rowSegments(listRow, width, {
                    selected: index === cursor,
                    focused: !model.filter.focused,
                    marker: false,
                    chip: false,
                    ...(all && model.filter.text.value
                      ? { highlight: model.filter.text.value }
                      : {}),
                    thumb: false,
                  })
            }
          />
        );
      })}
    </Box>
  );
}

/** The highlighted setting, then the edits so far: beside the settings on a wide terminal. */
function SidePanel({
  model,
  width,
  height,
}: {
  model: EditorModel;
  width: number;
  height: number;
}) {
  const inner = panelInner(width, height);
  const w = inner.width;
  const row = editorCurrentRow(model);
  const takes = editorTakes(model);
  const facts: DetailRow[] = row
    ? [
        { label: "Key", value: row.key, dim: true },
        { label: "Now", value: row.value, ...(row.changed ? { tone: "accent" as const } : {}) },
        ...(row.was ? [{ label: "On disk", value: row.was }] : []),
        ...(takes ? [{ label: "Takes", value: takes }] : []),
        ...(row.locked ? [{ label: "Locked", value: row.locked, tone: "warning" as const }] : []),
        ...(!row.locked && !takes && !row.field
          ? [{ label: "Not text", value: "change it in BambuStudio", tone: "warning" as const }]
          : []),
      ]
    : [];
  // Detail's value column: what's left after a margin, the labels, a gap and a margin.
  const keyRoom = Math.max(8, w - 1 - labelColumn(facts) - 2 - 1);
  const about: DetailRow[] = facts.flatMap((fact) =>
    fact.label === "Key"
      ? wrapKey(fact.value, keyRoom).map((part, index) => ({
          ...fact,
          label: index === 0 ? "Key" : "",
          value: part,
        }))
      : [fact],
  );
  const changes = editorChanges(model);
  // Two lines a change, under the setting's rows, a gap and the heading.
  const fit = Math.max(0, Math.floor((inner.height - about.length - 3) / 2));
  const shown = changes.length > fit ? Math.max(0, fit - 1) : changes.length;
  return (
    <Panel
      title={row && model.page !== ALL_SETTINGS ? row.label : "Setting"}
      width={width}
      height={height}
    >
      <Detail rows={about} width={w} />
      <Line segments={[]} width={w} />
      <Line
        segments={[
          { text: " Changes", bold: true },
          ...(changes.length ? [{ text: ` · ${changes.length}`, color: COLORS.muted }] : []),
        ]}
        width={w}
      />
      {changes.length === 0 ? (
        <Line segments={[{ text: " Nothing changed yet", color: COLORS.muted }]} width={w} />
      ) : (
        changes.slice(0, shown).map((change) => (
          <Box key={change.key} flexDirection="column">
            <Line segments={[{ text: `  ${change.label}`, color: COLORS.muted }]} width={w} />
            <Line
              segments={[
                { text: `    ${change.from}`, dim: true },
                { text: " → " },
                { text: change.to, color: COLORS.accent, bold: true },
              ]}
              width={w}
            />
          </Box>
        ))
      )}
      {shown < changes.length ? (
        <Line
          segments={[{ text: `  … ${changes.length - shown} more`, color: COLORS.muted }]}
          width={w}
        />
      ) : null}
    </Panel>
  );
}

/** A key in lines of at most width columns, broken after underscores where it can be. */
function wrapKey(key: string, width: number): string[] {
  const lines: string[] = [];
  let rest = key;
  while (textWidth(rest) > width) {
    const cut = rest.lastIndexOf("_", width - 1);
    const at = cut > 0 ? cut + 1 : width;
    lines.push(rest.slice(0, at));
    rest = rest.slice(at);
  }
  return [...lines, rest];
}

export interface EditorViewProps {
  model: EditorModel;
  width: number;
  height: number;
}

export function EditorView({ model, width, height }: EditorViewProps) {
  const [main = width, side = 0] = width >= EDITOR_SIDE_MIN ? splitWidths(width, [5, 3]) : [width];
  const inner = panelInner(main, height);
  const rows = editorRows(model);
  const cursor = Math.min(model.cursors[model.page] ?? 0, Math.max(0, rows.length - 1));
  const pages: Page[] = editorPages(model).map((page, index) => ({
    id: page.id,
    title: page.title,
    state: index === model.page ? "current" : "todo",
    ...(page.badge ? { badge: page.badge } : {}),
  }));
  const changed = model.edits.size;
  const position = listPosition(cursor, rows.length);
  return (
    <Box flexDirection="row" width={width} height={height}>
      <Panel
        title={`Edit ${model.name}`}
        {...(model.printer ? { subtitle: printerLabel(model.printer) } : {})}
        focused
        width={main}
        height={height}
        footerRight={[changed ? plural(changed, "change") : "no changes", position]
          .filter(Boolean)
          .join(" · ")}
      >
        <PageBar pages={pages} width={inner.width} />
        <FilterLine model={model} width={inner.width} />
        <Settings
          model={model}
          width={inner.width}
          height={Math.max(1, inner.height - EDITOR_CHROME)}
        />
        <Line segments={[]} width={inner.width} />
        <Line
          segments={[
            { text: spaces(1) },
            ...noteSegments(model, rows[cursor], side === 0, inner.width - 2),
          ]}
          width={inner.width}
        />
      </Panel>
      {side > 0 ? <SidePanel model={model} width={side} height={height} /> : null}
    </Box>
  );
}
