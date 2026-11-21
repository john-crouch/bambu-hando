// ABOUTME: A dialog: an accent-bordered box with its title in the top border and its own key line, painted opaque.
// ABOUTME: Frame centers it over the body; dialogInner says how wide its content may be.

import { Box, Text } from "ink";
import type { ReactNode } from "react";

import type { Hint } from "../core/types.js";
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

export interface DialogProps {
  title: string;
  width?: number;
  hints: readonly Hint[];
  children?: ReactNode;
}

/** Lines of cover: more than any terminal has rows; clipped to the dialog's own height. */
const COVER_ROWS = 200;

export function Dialog({ title, width = DIALOG_WIDTH, hints, children }: DialogProps) {
  const inner = dialogInner(width);
  const keys = hintSegments(fitHints(hints, inner));
  const cover = Array.from({ length: COVER_ROWS }, () => spaces(width - 2)).join("\n");
  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      <Line segments={panelTop(width, title, undefined, true)} width={width} />
      <Box
        borderStyle="round"
        borderTop={false}
        borderBottom={false}
        borderColor={COLORS.accent}
        flexDirection="column"
        overflow="hidden"
        width={width}
        flexShrink={0}
      >
        {/* Paints the dialog's inside with spaces, so the body under it doesn't show through. */}
        <Box position="absolute" top={0} left={0} width={width - 2} flexDirection="column">
          <Text>{cover}</Text>
        </Box>
        <Box flexDirection="column" paddingX={SIDE - 1} paddingTop={1} width={width - 2}>
          {children}
        </Box>
        <Box paddingX={SIDE - 1} paddingY={1} width={width - 2}>
          <Line segments={keys} width={inner} />
        </Box>
      </Box>
      <Line segments={panelBottom(width, undefined, true)} width={width} />
    </Box>
  );
}
