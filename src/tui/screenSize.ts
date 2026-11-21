// ABOUTME: Sizes TUI lists from the terminal's height, and follows the terminal as it is resized.
// ABOUTME: listRows is pure; useTerminalRows is the hook App reads the height from.

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

/** A stream's height in rows: Ink types stdout as any writable stream, and only a terminal has one. */
function streamRows(stream: NodeJS.WritableStream): number | undefined {
  return "rows" in stream && typeof stream.rows === "number" ? stream.rows : undefined;
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
