// ABOUTME: A dialog: an accent-bordered box with its title in the top border and a note in the bottom one, painted opaque.
// ABOUTME: Its keys go in the footer (one place for keys); Frame centers it over the body; dialogInner gives its content width.

import { Box, Text } from "ink";
import { type ReactNode, useContext } from "react";

import type { Hint } from "../core/types.js";
import { Backdrop } from "./backdrop.js";
import { fitHints, hintSegments } from "./hints.js";
import { Line } from "./Line.js";
import { panelBottom, panelTop } from "./Panel.js";
import { spaces } from "./text.js";
import { COLORS } from "./theme.js";

export const DIALOG_WIDTH = 56;

/** Columns of border and padding on each side. */
const SIDE = 3;

/** Content width inside a dialog of this width. */
export function dialogInner(width: number): number {
  return Math.max(0, width - 2 * SIDE);
}

/**
 * Below this many free columns, a dialog takes the whole width: thinner margins (less the halo Frame
 * clears round it) only show strips of cut words from the body.
 */
const MIN_MARGINS = 24;

/** Rows a dialog may take in a body of rows: all but the halo's row above and below it. */
export function dialogRows(rows: number): number {
  return Math.max(0, rows - 2);
}

/** A dialog's width in a body of columns: the width it wants, or all of it when the margins would be slivers. */
export function dialogWidth(columns: number, wanted: number): number {
  return columns - wanted < MIN_MARGINS ? Math.max(0, columns) : wanted;
}

export interface DialogProps {
  title: string;
  width?: number;
  /**
   * A key line inside the dialog. Leave it out: the footer shows the dialog's keys (the shell puts an
   * overlay's hints there, and a tab's own while its modal is true).
   */
  hints?: readonly Hint[];
  /** Set into the bottom border's right end, e.g. "↓ more". */
  note?: string;
  children?: ReactNode;
}

/** Lines of cover: more than any terminal has rows; clipped to the dialog's own height. */
const COVER_ROWS = 200;

export function Dialog({ title, width = DIALOG_WIDTH, hints = [], note, children }: DialogProps) {
  const inner = dialogInner(width);
  // Under the shell's overlay a tab's dialog is backdrop too: its borders go gray and dim with the rest.
  const backdrop = useContext(Backdrop);
  const keys = hintSegments(fitHints(hints, inner));
  const cover = Array.from({ length: COVER_ROWS }, () => spaces(width - 2)).join("\n");
  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      <Line segments={panelTop(width, title, undefined, true)} width={width} />
      <Box
        borderStyle="round"
        borderTop={false}
        borderBottom={false}
        borderColor={backdrop ? COLORS.border : COLORS.accent}
        borderDimColor={backdrop}
        flexDirection="column"
        overflow="hidden"
        width={width}
        flexShrink={0}
      >
        {/* Paints the dialog's inside with spaces, so the body under it doesn't show through. */}
        <Box position="absolute" top={0} left={0} width={width - 2} flexDirection="column">
          <Text>{cover}</Text>
        </Box>
        <Box flexDirection="column" paddingX={SIDE - 1} paddingY={1} width={width - 2}>
          {children}
        </Box>
        {keys.length > 0 ? (
          <Box paddingX={SIDE - 1} paddingBottom={1} width={width - 2}>
            <Line segments={keys} width={inner} />
          </Box>
        ) : null}
      </Box>
      <Line segments={panelBottom(width, note, true)} width={width} />
    </Box>
  );
}
