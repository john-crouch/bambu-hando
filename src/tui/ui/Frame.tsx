// ABOUTME: The full-screen frame: header line, body, footer line, exactly the terminal's size; dialogs centered on the body.
// ABOUTME: A tab's dialog and the shell's overlay draw over a dimmed body (the dialog dimmed too under an overlay); frameBody sizes the body.

import { Box } from "ink";
import type { ReactNode } from "react";

import { Backdrop } from "./backdrop.js";
import { type Toast, ToastLine } from "./Toast.js";

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

/** A dialog centered over the body: the layer's own box, so the body's layout never moves for it. */
function Centered({
  columns,
  rows,
  children,
}: {
  columns: number;
  rows: number;
  children: ReactNode;
}) {
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
      {children}
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
