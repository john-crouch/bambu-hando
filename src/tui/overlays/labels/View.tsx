// ABOUTME: The labels overlay's view: field ticks in two columns beside a preview of the label, then size, printer, PDF.
// ABOUTME: Printer and PDF choices open as a list in the dialog; the Make labels line says what pressing it does.

import { Box } from "ink";

import { LABEL_FIELDS } from "../../../labels.js";
import type { Ctx } from "../../core/types.js";
import {
  Busy,
  COLORS,
  Dialog,
  dialogInner,
  dialogWidth,
  fitPath,
  Line,
  List,
  type ListRow,
  listPosition,
  plural,
  type Segment,
  TextField,
  textWidth,
  truncate,
} from "../../ui/index.js";
import { LABEL_FIELD_NAME_MAX, labelFieldName } from "./fields.js";
import {
  COMMON_SIZES,
  FIELD_ROWS,
  type LabelPreview,
  type LabelsModel,
  labelPreview,
  labelTarget,
  MAKE_ROW,
  OTHER_OUTPUT,
  OUTPUT_ROW,
  outputChoices,
  PRINTER_ROW,
  printerChoices,
  SIZE_ROW,
} from "./model.js";

/** Columns of one field cell: the focus gutter, "[✓]", a space, then the longest field name. */
const FIELD_CELL = 5 + LABEL_FIELD_NAME_MAX;
/** The form rows' labels, "Save PDF to" the longest; two columns follow before the value. */
const LABEL_COLUMN = 11;
/** Lines inside the preview card: fixed, so ticking a field never makes the dialog jump. */
const PREVIEW_LINES = FIELD_ROWS;
/** Body rows the full form needs (the spool IDs line included) before it drops that line. */
const FULL_FORM_ROWS = 20;

/** The focused row's look, one style for every row (as in lists): ▌ in the gutter and the selection bar. */
const FOCUSED: Omit<Segment, "text"> = { backgroundColor: COLORS.selection };

function gutter(focused: boolean): Segment {
  return focused ? { text: "▌", color: COLORS.accent, ...FOCUSED } : { text: " " };
}

function fieldCell(model: LabelsModel, index: number, focused: boolean): Segment[] {
  const field = LABEL_FIELDS[index];
  if (!field) return [{ text: " ".repeat(FIELD_CELL) }];
  const on = model.fields.includes(field.key);
  const bar = focused ? FOCUSED : {};
  const text = ` ${labelFieldName(field.key)}`.padEnd(FIELD_CELL - 4);
  return [
    gutter(focused),
    { text: "[", color: COLORS.muted, ...bar },
    on ? { text: "✓", color: COLORS.ok, bold: true, ...bar } : { text: " ", ...bar },
    { text: "]", color: COLORS.muted, ...bar },
    {
      text,
      ...bar,
      ...(focused ? { color: COLORS.selectionText, bold: true } : on ? {} : { dim: true }),
    },
  ];
}

/** The label as it prints: a QR block when it has one, then its lines in their weights; always PREVIEW_LINES tall. */
function Preview({ preview, width }: { preview: LabelPreview | null; width: number }) {
  const lines: Segment[][] = [];
  if (!preview) {
    lines.push([{ text: "No preview until the", color: COLORS.muted }]);
    lines.push([{ text: "spool is read.", color: COLORS.muted }]);
  } else {
    // The QR mark takes four columns and a gap; on a narrow card two.
    const mark = width >= 22 ? "▚▞▚▞" : "▚▞";
    const qr = preview.qr ? mark.length + 1 : 0;
    const room = width - 4 - qr;
    const overflow = preview.lines.length > PREVIEW_LINES;
    const shown = overflow ? preview.lines.slice(0, PREVIEW_LINES - 1) : preview.lines;
    for (let i = 0; i < PREVIEW_LINES; i++) {
      const line = shown[i];
      const block: Segment[] = preview.qr
        ? [{ text: i < 3 ? mark : " ".repeat(mark.length), color: COLORS.muted }, { text: " " }]
        : [];
      const text: Segment[] = line
        ? [
            {
              text: truncate(line.text, room),
              ...(line.style === "title" || line.style === "strong" ? { bold: true } : {}),
              ...(line.style === "small" ? { dim: true } : {}),
            },
          ]
        : overflow && i === PREVIEW_LINES - 1
          ? [
              {
                text: `+${preview.lines.length - shown.length} more`,
                color: COLORS.muted,
              },
            ]
          : [];
      lines.push([...block, ...text]);
    }
  }
  while (lines.length < PREVIEW_LINES) lines.push([]);
  const inner = width - 2;
  const id = ` #${preview?.spoolId ?? "?"} `;
  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      <Line
        segments={[
          { text: "╭", color: COLORS.border },
          { text: id, color: COLORS.muted },
          { text: "─".repeat(Math.max(0, inner - textWidth(id))), color: COLORS.border },
          { text: "╮", color: COLORS.border },
        ]}
        width={width}
      />
      {lines.map((segments, index) => (
        <Line
          // biome-ignore lint/suspicious/noArrayIndexKey: positional lines of one label.
          key={index}
          segments={[
            { text: "│ ", color: COLORS.border },
            ...segments,
            { text: " ".repeat(Math.max(0, inner - 1 - lineWidth(segments))) },
            { text: "│", color: COLORS.border },
          ]}
          width={width}
        />
      ))}
      <Line
        segments={[{ text: `╰${"─".repeat(Math.max(0, inner))}╯`, color: COLORS.border }]}
        width={width}
      />
    </Box>
  );
}

function lineWidth(segments: Segment[]): number {
  return segments.reduce((sum, s) => sum + textWidth(s.text), 0);
}

/** A form row: its label, then its value; the focused one is the selection bar, like the field cells. */
function FormRow({
  label,
  value,
  focused,
  width,
}: {
  label: string;
  value: Segment[];
  focused: boolean;
  width: number;
}) {
  const bar = focused ? FOCUSED : {};
  return (
    <Line
      segments={[
        gutter(focused),
        {
          text: label.padEnd(LABEL_COLUMN + 2),
          ...bar,
          ...(focused ? { color: COLORS.selectionText, bold: true } : { color: COLORS.muted }),
        },
        ...value.map((segment) => ({ ...segment, ...bar })),
      ]}
      width={width}
      {...(focused ? { fill: FOCUSED } : {})}
    />
  );
}

function outputLabel(choice: string, width: number): string {
  return choice === "" ? "No PDF" : fitPath(choice, width);
}

/**
 * What Make labels does, named ("Print 2 labels on DYMO and save ~/labels.pdf"), or what's missing
 * first; a PDF path is shortened to fit width with its file name kept.
 */
export function makeSummary(
  model: LabelsModel,
  width = Number.POSITIVE_INFINITY,
): { ready: boolean; text: string } {
  const target = labelTarget(model);
  if ("error" in target) return { ready: false, text: target.error };
  const count = plural(model.request.spoolIds.length, "label");
  const output = model.output.value.trim();
  const save = (prefix: string) =>
    `${prefix}${Number.isFinite(width) ? fitPath(output, width - textWidth(prefix)) : output}`;
  if (model.printer && output)
    return { ready: true, text: save(`Print ${count} on ${model.printer} and save `) };
  if (model.printer) return { ready: true, text: `Print ${count} on ${model.printer}` };
  return { ready: true, text: save(`Save ${count} to `) };
}

/** Rows the choices get: what's left of the body under the dialog's borders, padding and prose. */
function pickerHeight(ctx: Ctx, count: number): number {
  return Math.max(1, Math.min(count, ctx.bodyRows - 8));
}

/** The Printer or Save PDF choices, in place of the form while open. */
function Picker({
  model,
  ctx,
  picker,
  width,
}: {
  model: LabelsModel;
  ctx: Ctx;
  picker: { row: number; cursor: number };
  width: number;
}) {
  const printing = picker.row === PRINTER_ROW;
  const choices = printing ? printerChoices(model) : outputChoices(model, ctx);
  const current = printing ? model.printer : model.output.value.trim();
  // The radio's gutter and the "type a path" note take this much of the row.
  const room = width - 4 - (printing ? 0 : 12);
  const rows: ListRow[] = choices.map((choice) => ({
    key: choice || "none",
    ticked: choice === current,
    cells: [
      {
        text: printing ? choice || "Don't print" : outputLabel(choice, room),
        grow: true,
      },
      ...(choice === OTHER_OUTPUT ? [{ text: "type a path", dim: true }] : []),
    ],
  }));
  const height = pickerHeight(ctx, rows.length);
  return (
    <>
      <Line
        segments={[
          {
            text: printing
              ? model.printers.length === 0
                ? "No CUPS printers found: save a PDF instead."
                : "Print the labels on"
              : "Save the labels as a PDF",
            color: COLORS.muted,
          },
        ]}
        width={width}
      />
      <Line segments={[]} width={width} />
      <List rows={rows} cursor={picker.cursor} height={height} width={width} marker="radio" />
    </>
  );
}

export function LabelsView({ model, ctx }: { model: LabelsModel; ctx: Ctx }) {
  const width = dialogWidth(ctx.bodyColumns, 78);
  const inner = dialogInner(width);
  const count = model.request.spoolIds.length;
  const title = `Labels for ${plural(count, model.request.fresh ? "new spool" : "spool")}`;
  // The overlay's keys are in the footer (the shell puts its hints there), so the dialog doesn't repeat them.
  if (model.phase !== "ready")
    return (
      <Dialog title={title} width={width}>
        <Busy message={model.phase === "loading" ? "Looking for printers…" : "Making labels…"} />
      </Dialog>
    );
  if (model.picker) {
    const count = (
      model.picker.row === PRINTER_ROW ? printerChoices(model) : outputChoices(model, ctx)
    ).length;
    // Where the cursor is, when the choices scroll.
    const note =
      count > pickerHeight(ctx, count) ? listPosition(model.picker.cursor, count) : undefined;
    return (
      <Dialog
        title={`${title} · ${model.picker.row === PRINTER_ROW ? "Printer" : "Save PDF to"}`}
        width={width}
        {...(note ? { note } : {})}
      >
        <Picker model={model} ctx={ctx} picker={model.picker} width={inner} />
      </Dialog>
    );
  }

  const grid = 2 * FIELD_CELL + 1;
  // Two columns between the ticks and the card, one when that keeps a narrow card readable.
  const previewGap = inner - grid - 2 >= 22 ? 2 : 1;
  const previewWidth = inner - grid - previewGap;
  const showPreview = previewWidth >= 16;
  // One spool is named on its preview card already.
  const showIds = count > 1 && ctx.bodyRows >= FULL_FORM_ROWS;
  const focusedField = LABEL_FIELDS[model.focus];
  const size = COMMON_SIZES.find((s) => s.size === model.size);
  const valueWidth = inner - LABEL_COLUMN - 3;
  const make = makeSummary(model, valueWidth);
  const ids = truncate(model.request.spoolIds.map((id) => `#${id}`).join(" "), inner);
  const muted = (text: string): Segment => ({ text, color: COLORS.muted });

  return (
    <Dialog title={title} width={width}>
      {showIds ? <Line segments={[muted(ids)]} width={inner} /> : null}
      <Box flexDirection="row">
        <Box flexDirection="column" width={grid} flexShrink={0}>
          {Array.from({ length: FIELD_ROWS }, (_, row) => (
            <Line
              // biome-ignore lint/suspicious/noArrayIndexKey: the grid's rows are positional.
              key={row}
              segments={[
                ...fieldCell(model, row, model.focus === row),
                { text: " " },
                ...fieldCell(model, row + FIELD_ROWS, model.focus === row + FIELD_ROWS),
              ]}
              width={grid}
            />
          ))}
        </Box>
        {showPreview ? (
          <Box marginLeft={previewGap} flexShrink={0}>
            <Preview preview={labelPreview(model, ctx)} width={previewWidth} />
          </Box>
        ) : null}
      </Box>
      <Line
        segments={[muted(focusedField ? focusedField.description : "Fields print in this order.")]}
        width={inner}
      />
      <FormRow
        label="Size"
        value={[
          // A stepper while focused: ←→ go through the common sizes.
          { text: model.focus === SIZE_ROW ? `‹ ${model.size} ›` : model.size },
          ...(size?.detail ? [muted(`  ${size.detail}`)] : []),
        ]}
        focused={model.focus === SIZE_ROW}
        width={inner}
      />
      <FormRow
        label="Printer"
        value={[
          model.printer ? { text: model.printer } : muted("Don't print"),
          ...(model.printers.length === 0 ? [muted("  no CUPS printers found")] : []),
        ]}
        focused={model.focus === PRINTER_ROW}
        width={inner}
      />
      {model.editing ? (
        <Box flexDirection="row">
          <FormRow label="Save PDF to" value={[]} focused width={LABEL_COLUMN + 3} />
          <TextField
            value={model.output.value}
            cursor={model.output.cursor}
            focused
            placeholder="~/labels.pdf"
            width={inner - LABEL_COLUMN - 3}
          />
        </Box>
      ) : (
        <FormRow
          label="Save PDF to"
          value={[
            model.output.value.trim()
              ? { text: fitPath(model.output.value.trim(), valueWidth) }
              : muted("No PDF"),
          ]}
          focused={model.focus === OUTPUT_ROW}
          width={inner}
        />
      )}
      <FormRow
        label="Make"
        value={[
          make.ready
            ? { text: make.text, ...(model.focus === MAKE_ROW ? { bold: true } : {}) }
            : { text: make.text, color: COLORS.warning },
        ]}
        focused={model.focus === MAKE_ROW}
        width={inner}
      />
      {model.error ? (
        <Line segments={[{ text: `✗ ${model.error}`, color: COLORS.failed }]} width={inner} />
      ) : null}
    </Dialog>
  );
}
