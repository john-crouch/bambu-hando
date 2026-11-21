// ABOUTME: The "Other color…" dialog: the listed color it copies, the new name and hex with a live swatch, and Add color.
// ABOUTME: Render-only; colorDialogKey in color.ts edits the dialog the model keeps.

import { Box } from "ink";

import type { FilamentProfile } from "../../../models.js";
import { formatGrams, formatRange } from "../../ui/format.js";
import {
  DIALOG_WIDTH,
  Dialog,
  dialogInner,
  Line,
  type Segment,
  TextField,
} from "../../ui/index.js";
import { swatchSegments } from "../../ui/Swatch.js";
import { textWidth, truncate } from "../../ui/text.js";
import { COLORS } from "../../ui/theme.js";
import { type ColorDialog, type ColorField, typedColor } from "./color.js";

const LABEL = 17;

function label(text: string, focused: boolean): Segment[] {
  return [
    { text: focused ? "▸ " : "  ", color: COLORS.accent },
    { text: text.padEnd(LABEL - 2), color: focused ? COLORS.accent : COLORS.muted, bold: focused },
  ];
}

/** Columns the base row's frame takes: "‹ ", the swatch, its gap, and " ›". */
const BASE_FRAME = 7;

/**
 * The listed color the new one copies, framed by ‹ ›: its facts are left out before its name is cut,
 * and the closing › always shows, since it says ←→ changes it.
 */
function baseChoice(base: FilamentProfile, width: number): Segment[] {
  const room = Math.max(0, width - BASE_FRAME);
  const facts = ` · ${formatRange(base.nozzleTempMin, base.nozzleTempMax)}${base.labelWeight ? ` · ${formatGrams(base.labelWeight)}` : ""}`;
  const name = base.colorName || base.name;
  const withFacts = textWidth(name) + textWidth(facts) <= room;
  return [
    { text: "‹ ", color: COLORS.muted },
    ...swatchSegments(`#${base.colorRgba.slice(0, 6)}`, 2),
    { text: ` ${truncate(name, room)}` },
    ...(withFacts ? [{ text: facts, color: COLORS.muted }] : []),
    { text: " ›", color: COLORS.muted },
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
    ? baseChoice(base, value)
    : [{ text: "‹ choose with ←→ ›", color: at("base") ? COLORS.accent2 : COLORS.muted }];
  return (
    <Dialog
      title={`Other color · ${dialog.brand} ${dialog.material}`}
      width={width}
      // The footer has the dialog's keys (the tab is modal meanwhile): no second key line in here.
      hints={[]}
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
