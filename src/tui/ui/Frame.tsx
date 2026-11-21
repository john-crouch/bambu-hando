// ABOUTME: The full-screen frame: header line, body, footer line, exactly the terminal's size; dialogs centered on the body.
// ABOUTME: A tab's dialog and the shell's overlay draw over a dimmed body (the dialog dimmed too under an overlay); frameBody sizes the body.

import { Box, Text } from "ink";
import type { ReactNode } from "react";

import { Backdrop } from "./backdrop.js";
import { type Toast, ToastLine } from "./Toast.js";
import { spaces } from "./text.js";

/** Rows the header and footer take. */
export const FRAME_CHROME = 2;

/** The body's share of a terminal of this size. */
export function frameBody(columns: number, rows: number): { columns: number; rows: number } {
  return { columns: Math.max(0, columns), rows: Math.max(0, rows - FRAME_CHROME) };
}

export interface FrameProps {
  columns: number;
  rows: number;
  header: ReactNode;
  footer: ReactNode;
  /** The active tab's own dialog, drawn centered over the body, which goes gray and dim behind it. */
  dialog?: ReactNode;
  /** The shell's overlay (help, palette, confirm, labels), drawn centered over the body and any tab dialog, both dimmed. */
  overlay?: ReactNode;
  /** Drawn as the body's whole last row, over everything else there. */
  toast?: Toast;
  children?: ReactNode;
}

interface LayerProps {
  columns: number;
  rows: number;
  children: ReactNode;
}

/**
 * A blank cell's halo round a dialog: the body never touches its border, so what shows of the body
 * beside it reads as behind it. The cover is wider and taller than any dialog (so Ink never wraps or
 * cuts it) and clipped to the halo; beside a dialog as wide as the body, the halo falls off the edges.
 */
function Halo({ columns, rows, children }: LayerProps) {
  const cover = Array.from({ length: rows + 2 }, () => spaces(columns + 2)).join("\n");
  return (
    <Box padding={1} flexShrink={0}>
      <Box position="absolute" top={0} left={0} width="100%" height="100%" overflow="hidden">
        <Box width={columns + 2} height={rows + 2} flexShrink={0}>
          <Text>{cover}</Text>
        </Box>
      </Box>
      {children}
    </Box>
  );
}

/** A dialog centered over the body in its halo: the layer's own box, so the body's layout never moves for it. */
function Centered({ columns, rows, children }: LayerProps) {
  return (
    <Box
      position="absolute"
      top={1}
      left={0}
      width={columns}
      height={rows}
      justifyContent="center"
      alignItems="center"
      overflow="hidden"
    >
      <Halo columns={columns} rows={rows}>
        {children}
      </Halo>
    </Box>
  );
}

export function Frame({
  columns,
  rows,
  header,
  footer,
  dialog,
  overlay,
  toast,
  children,
}: FrameProps) {
  const body = frameBody(columns, rows);
  return (
    <Box flexDirection="column" width={body.columns} height={Math.max(0, rows)} overflow="hidden">
      <Box height={1} width={body.columns} flexShrink={0} overflow="hidden">
        {header}
      </Box>
      <Box
        height={body.rows}
        width={body.columns}
        flexShrink={0}
        flexDirection="row"
        overflow="hidden"
      >
        {/* Behind a dialog the body is a backdrop: gray and dim, so the dialog stands out. */}
        <Backdrop.Provider value={Boolean(dialog || overlay)}>{children}</Backdrop.Provider>
      </Box>
      <Box height={1} width={body.columns} flexShrink={0} overflow="hidden">
        {footer}
      </Box>
      {dialog ? (
        <Centered columns={body.columns} rows={body.rows}>
          <Backdrop.Provider value={Boolean(overlay)}>{dialog}</Backdrop.Provider>
        </Centered>
      ) : null}
      {overlay ? (
        <Centered columns={body.columns} rows={body.rows}>
          {overlay}
        </Centered>
      ) : null}
      {toast && body.rows > 0 ? (
        <Box position="absolute" top={body.rows} left={0} height={1} width={body.columns}>
          <ToastLine toast={toast} width={body.columns} />
        </Box>
      ) : null}
    </Box>
  );
}
