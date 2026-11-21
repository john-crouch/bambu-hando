// ABOUTME: The labels overlay's view: field ticks in two columns beside a preview of the label, then size, printer, PDF.
// ABOUTME: The Make labels line says what pressing it does: which printer, which file, how many labels.

import { Box } from "ink";

import { LABEL_FIELDS } from "../../../labels.js";
import type { Ctx } from "../../core/types.js";
import {
  Busy,
  COLORS,
  Dialog,
  dialogInner,
  Line,
  type Segment,
  TextField,
  truncate,
} from "../../ui/index.js";
import {
  COMMON_SIZES,
  FIELD_ROWS,
  hints,
  type LabelPreview,
  type LabelsModel,
  labelPreview,
  MAKE_ROW,
  OUTPUT_ROW,
  PRINTER_ROW,
  SIZE_ROW,
} from "./model.js";

/** Columns of one field cell: "[✓] location". */
const FIELD_CELL = 14;
const LABEL_COLUMN = 10;

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function fieldCell(model: LabelsModel, index: number, focused: boolean): Segment[] {
  const field = LABEL_FIELDS[index];
  if (!field) return [{ text: " ".repeat(FIELD_CELL) }];
  const on = model.fields.includes(field.key);
  const bar = focused ? { backgroundColor: COLORS.selection } : {};
  const text = ` ${field.key}`.padEnd(FIELD_CELL - 3);
  return [
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

/** The label as it prints: a QR block when it has one, then its lines in their weights. */
function Preview({ preview, width }: { preview: LabelPreview | null; width: number }) {
  const lines: Segment[][] = [];
  if (!preview) {
    lines.push([{ text: "No preview until the", color: COLORS.muted }]);
    lines.push([{ text: "spool is read.", color: COLORS.muted }]);
  } else {
    const qr = preview.qr ? 5 : 0;
    const room = width - 4 - qr;
    const rows = Math.max(preview.lines.length, preview.qr ? 3 : 1);
    for (let i = 0; i < rows; i++) {
      const line = preview.lines[i];
      const block: Segment[] = preview.qr
        ? [{ text: i < 3 ? "▚▞▚▞" : "    ", color: COLORS.muted }, { text: " " }]
        : [];
      const text: Segment[] = line
        ? [
            {
              text: truncate(line.text, room),
              ...(line.style === "title" || line.style === "strong" ? { bold: true } : {}),
              ...(line.style === "small" ? { dim: true } : {}),
            },
          ]
        : [];
      lines.push([...block, ...text]);
    }
  }
  const inner = width - 2;
  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      <Line
        segments={[
          { text: "╭", color: COLORS.border },
          {
            text: ` #${preview?.spoolId ?? "?"} `,
            color: COLORS.muted,
          },
          {
            text: "─".repeat(Math.max(0, inner - 3 - (preview?.spoolId.length ?? 1))),
            color: COLORS.border,
          },
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
  return segments.reduce((sum, s) => sum + [...s.text].length, 0);
}

function rowLabel(text: string, focused: boolean): Segment[] {
  return [
    { text: focused ? "▸ " : "  ", color: COLORS.accent },
    {
      text: text.padEnd(LABEL_COLUMN),
      ...(focused ? { color: COLORS.accent, bold: true } : { color: COLORS.muted }),
    },
  ];
}

function choice(value: string, focused: boolean, detail?: string): Segment[] {
  return [
    { text: focused ? "‹ " : "", color: COLORS.accent },
    { text: value, bold: focused },
    { text: focused ? " ›" : "", color: COLORS.accent },
    ...(detail ? [{ text: `  ${detail}`, color: COLORS.muted }] : []),
  ];
}

/** What Make labels does, named: "Print 2 labels on DYMO and save ~/labels.pdf". */
export function makeSummary(model: LabelsModel): string {
  const count = plural(model.request.spoolIds.length, "label");
  const output = model.output.value.trim();
  if (model.printer && output) return `Print ${count} on ${model.printer} and save ${output}`;
  if (model.printer) return `Print ${count} on ${model.printer}`;
  if (output) return `Save ${count} to ${output}`;
  return "Choose a printer, a PDF path, or both";
}

export function LabelsView({ model, ctx }: { model: LabelsModel; ctx: Ctx }) {
  const width = Math.min(78, Math.max(30, ctx.bodyColumns - 2));
  const inner = dialogInner(width);
  const count = model.request.spoolIds.length;
  const title = `Labels for ${plural(count, model.request.fresh ? "new spool" : "spool")}`;
  const ids = truncate(model.request.spoolIds.map((id) => `#${id}`).join(" "), inner);

  if (model.phase !== "ready")
    return (
      <Dialog title={title} width={width} hints={hints(model, ctx)}>
        <Busy message={model.phase === "loading" ? "Looking for printers…" : "Making labels…"} />
      </Dialog>
    );

  const grid = 2 * FIELD_CELL + 1;
  const previewWidth = inner - grid - 2;
  const showPreview = previewWidth >= 18;
  const focusedField = LABEL_FIELDS[model.focus];
  const size = COMMON_SIZES.find((s) => s.size === model.size);
  const make = makeSummary(model);
  const ready = make !== "Choose a printer, a PDF path, or both";

  return (
    <Dialog title={title} width={width} hints={hints(model, ctx)}>
      <Line segments={[{ text: ids, color: COLORS.muted }]} width={inner} />
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
          <Box marginLeft={2} flexShrink={0}>
            <Preview preview={labelPreview(model, ctx)} width={previewWidth} />
          </Box>
        ) : null}
      </Box>
      <Line
        segments={[
          {
            text: focusedField ? focusedField.description : "Fields print in this order.",
            color: COLORS.muted,
          },
        ]}
        width={inner}
      />
      <Line
        segments={[
          ...rowLabel("Size", model.focus === SIZE_ROW),
          ...choice(model.size, model.focus === SIZE_ROW, size?.detail),
        ]}
        width={inner}
      />
      <Line
        segments={[
          ...rowLabel("Printer", model.focus === PRINTER_ROW),
          ...choice(
            model.printer || "Don't print",
            model.focus === PRINTER_ROW,
            model.printers.length === 0 ? "no CUPS printers found" : undefined,
          ),
        ]}
        width={inner}
      />
      <Box flexDirection="row">
        <Line segments={rowLabel("Save PDF", model.focus === OUTPUT_ROW)} width={12} />
        <TextField
          value={model.output.value}
          cursor={model.output.cursor}
          focused={model.focus === OUTPUT_ROW}
          placeholder="don't save a PDF"
          width={inner - 12}
        />
      </Box>
      <Line
        segments={[
          ...rowLabel("Make", model.focus === MAKE_ROW),
          {
            text: make,
            ...(ready
              ? model.focus === MAKE_ROW
                ? { color: COLORS.accent, bold: true }
                : {}
              : { color: COLORS.muted }),
          },
        ]}
        width={inner}
      />
      {model.error ? (
        <Line segments={[{ text: `✗ ${model.error}`, color: COLORS.failed }]} width={inner} />
      ) : null}
    </Dialog>
  );
}
