// ABOUTME: The full-screen frame: header line, body, footer line, exactly the terminal's size; overlays centered on the body.
// ABOUTME: The shell passes the terminal's size; frameBody says how much of it the body gets.

import { Box } from "ink";
import type { ReactNode } from "react";

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
  /** Drawn centered over the body (a Dialog, which paints its own background). */
  overlay?: ReactNode;
  /** Drawn over the body's last line (usually a panel's bottom border), two columns in, over any overlay. */
  toast?: Toast;
  children?: ReactNode;
}

/** Columns a toast starts in, and the columns it leaves free at the right (a panel's "3/14" note). */
const TOAST_LEFT = 2;
const TOAST_RIGHT = 12;

export function Frame({ columns, rows, header, footer, overlay, toast, children }: FrameProps) {
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
        {children}
      </Box>
      <Box height={1} width={body.columns} flexShrink={0} overflow="hidden">
        {footer}
      </Box>
      {overlay ? (
        <Box
          position="absolute"
          top={1}
          left={0}
          width={body.columns}
          height={body.rows}
          justifyContent="center"
          alignItems="center"
          overflow="hidden"
        >
          {overlay}
        </Box>
      ) : null}
      {toast && body.rows > 0 ? (
        <Box position="absolute" top={body.rows} left={TOAST_LEFT} height={1}>
          <ToastLine toast={toast} room={Math.max(0, body.columns - TOAST_LEFT - TOAST_RIGHT)} />
        </Box>
      ) : null}
    </Box>
  );
}
