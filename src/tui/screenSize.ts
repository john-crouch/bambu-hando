// ABOUTME: Sizes TUI lists from the terminal's height and tables from its width, following it as it is resized.
// ABOUTME: listRows and fitColumns are pure; useTerminalRows and useTerminalColumns are the hooks App reads them from.

import { useStdout } from "ink";
import { useEffect, useState } from "react";

/** A list never shrinks below this, however short the terminal. */
export const MIN_LIST_ROWS = 3;

/**
 * Rows for a list: the terminal's height minus the screen's other lines (`chrome`, including a spare
 * line, since Ink redraws a screen as tall as the terminal from the top every frame). `fallback` when the
 * height is unknown, as when the output isn't a terminal.
 */
export function listRows(
  terminalRows: number | undefined,
  chrome: number,
  fallback: number,
): number {
  if (!terminalRows) return fallback;
  return Math.max(MIN_LIST_ROWS, terminalRows - chrome);
}

/**
 * Column widths fitted to `available` columns: the columns over it come off the `shrink` columns in
 * order, each down to its minimum, in whole columns, so no cell is laid out a fraction wide. Widths
 * stay as they are when `available` is unknown (output that isn't a terminal) or the table fits.
 */
export function fitColumns<K extends string>(
  widths: Readonly<Record<K, number>>,
  available: number | undefined,
  shrink: readonly (readonly [K, number])[],
): Record<K, number> {
  const fitted: Record<K, number> = { ...widths };
  if (available === undefined) return fitted;
  const total = (Object.values(widths) as number[]).reduce((sum, width) => sum + width, 0);
  let over = Math.max(0, Math.ceil(total - available));
  for (const [key, min] of shrink) {
    const taken = Math.min(over, Math.max(0, fitted[key] - min));
    fitted[key] -= taken;
    over -= taken;
  }
  return fitted;
}

/** A stream's height in rows: Ink types stdout as any writable stream, and only a terminal has one. */
function streamRows(stream: NodeJS.WritableStream): number | undefined {
  return "rows" in stream && typeof stream.rows === "number" ? stream.rows : undefined;
}

/** A stream's width in columns, for the same reason as streamRows. */
function streamColumns(stream: NodeJS.WritableStream): number | undefined {
  return "columns" in stream && typeof stream.columns === "number" ? stream.columns : undefined;
}

/** The terminal's height in rows, updated on resize; undefined when stdout isn't a terminal. */
export function useTerminalRows(): number | undefined {
  const { stdout } = useStdout();
  const [rows, setRows] = useState<number | undefined>(streamRows(stdout));
  useEffect(() => {
    const onResize = (): void => setRows(streamRows(stdout));
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);
  return rows;
}

/** The terminal's width in columns, updated on resize; undefined when stdout isn't a terminal. */
export function useTerminalColumns(): number | undefined {
  const { stdout } = useStdout();
  const [columns, setColumns] = useState<number | undefined>(streamColumns(stdout));
  useEffect(() => {
    const onResize = (): void => setColumns(streamColumns(stdout));
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);
  return columns;
}
