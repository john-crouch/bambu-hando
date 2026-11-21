// ABOUTME: The "Other color…" dialog: the listed color it copies, the new name and hex with a live swatch, and Add color.
// ABOUTME: Render-only; colorDialogKey in color.ts edits the dialog the model keeps.

import { Box } from "ink";

import type { Hint } from "../../core/types.js";
import {
  DIALOG_WIDTH,
  Dialog,
  dialogInner,
  Line,
  type Segment,
  TextField,
} from "../../ui/index.js";
import { swatchSegments } from "../../ui/Swatch.js";
import { COLORS } from "../../ui/theme.js";
import { tempsText } from "./catalog.js";
import { type ColorDialog, type ColorField, typedColor } from "./color.js";

const LABEL = 17;

function label(text: string, focused: boolean): Segment[] {
  return [
    { text: focused ? "▸ " : "  ", color: COLORS.accent },
    { text: text.padEnd(LABEL - 2), color: focused ? COLORS.accent : COLORS.muted, bold: focused },
  ];
}

export function dialogHints(field: ColorField): Hint[] {
  return [
    { keys: "↑↓", label: "field" },
    ...(field === "base" ? [{ keys: "←→", label: "listed color" }] : []),
    { keys: "enter", label: field === "add" ? "add color" : "next" },
    { keys: "esc", label: "cancel" },
  ];
}

export function ColorDialogView({ dialog, columns }: { dialog: ColorDialog; columns: number }) {
  const width = Math.min(DIALOG_WIDTH + 8, Math.max(30, columns - 4));
  const inner = dialogInner(width);
  const value = Math.max(0, inner - LABEL);
  const base = dialog.base === null ? undefined : dialog.bases[dialog.base];
  const color = typedColor(dialog.hex.value);
  const at = (field: ColorField) => dialog.field === field;
  const baseSegments: Segment[] = base
    ? [
        { text: "‹ ", color: COLORS.muted },
        ...swatchSegments(`#${base.colorRgba.slice(0, 6)}`, 2),
        { text: ` ${base.colorName}` },
        {
          text: ` · ${tempsText(base.nozzleTempMin, base.nozzleTempMax)}${base.labelWeight ? ` · ${base.labelWeight} g` : ""}`,
          color: COLORS.muted,
        },
        { text: " ›", color: COLORS.muted },
      ]
    : [{ text: "‹ choose with ←→ ›", color: at("base") ? COLORS.accent2 : COLORS.muted }];
  return (
    <Dialog
      title={`Other color · ${dialog.brand} ${dialog.material}`}
      width={width}
      hints={dialogHints(dialog.field)}
    >
      <Line
        width={inner}
        segments={[
          { text: "Settings come from the listed color you choose.", color: COLORS.muted },
        ]}
      />
      <Line width={inner} segments={[]} />
      <Line width={inner} segments={[...label("Settings from", at("base")), ...baseSegments]} />
      <Box>
        <Line width={LABEL} segments={label("Color name", at("name"))} />
        <TextField
          value={dialog.name.value}
          cursor={dialog.name.cursor}
          focused={at("name")}
          placeholder="as on the spool, e.g. Moss Green"
          width={value}
        />
      </Box>
      <Box>
        <Line width={LABEL} segments={label("Color", at("hex"))} />
        <Line
          width={3}
          segments={
            color
              ? [...swatchSegments(color, 2), { text: " " }]
              : [{ text: "-- ", color: COLORS.muted }]
          }
        />
        <TextField
          value={dialog.hex.value}
          cursor={dialog.hex.cursor}
          focused={at("hex")}
          placeholder="6 hex digits, e.g. 4A5D23"
          width={Math.max(0, value - 3)}
        />
      </Box>
      <Line width={inner} segments={[]} />
      <Line
        width={inner}
        segments={[
          { text: at("add") ? "▸ " : "  ", color: COLORS.accent },
          at("add")
            ? {
                text: " Add color ",
                backgroundColor: COLORS.accent,
                color: COLORS.selectionText,
                bold: true,
              }
            : { text: "[ Add color ]", color: COLORS.muted },
        ]}
      />
      {dialog.error ? (
        <Line width={inner} segments={[{ text: `✗ ${dialog.error}`, color: COLORS.failed }]} />
      ) : null}
    </Dialog>
  );
}
