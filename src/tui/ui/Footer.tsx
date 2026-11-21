// ABOUTME: The footer line: the keys that work right now, primary ones kept when narrow, a toast at the right end.
// ABOUTME: A toast ("✓ 3 labels sent to DYMO") takes its room first; hints get what's left.

import type { Hint } from "../core/types.js";
import { fitHints, hintSegments } from "./hints.js";
import { Line } from "./Line.js";
import { type Segment, segmentsWidth, spaces, truncate } from "./text.js";
import { COLORS, ICONS } from "./theme.js";

export interface Toast {
  /** The message alone; the footer adds ✓ ! ✗ from the tone. */
  text: string;
  /** Default ok. */
  tone?: "ok" | "warning" | "failed";
}

const TOAST_ICONS = { ok: ICONS.ok, warning: ICONS.warning, failed: ICONS.failed } as const;

/** The toast's icon comes from its tone (ok when none): toast text never carries one. */
function toastSegments(toast: Toast | undefined, room: number): Segment[] {
  if (!toast || room < 3) return [];
  const tone = toast.tone ?? "ok";
  return [
    { text: truncate(`${TOAST_ICONS[tone]} ${toast.text}`, room), color: COLORS[tone], bold: true },
  ];
}

export function footerSegments(hints: readonly Hint[], columns: number, toast?: Toast): Segment[] {
  // One space margin each side.
  const inner = columns - 2;
  if (inner <= 0) return [];
  const right = toastSegments(toast, inner);
  const rightWidth = segmentsWidth(right);
  const room = rightWidth > 0 ? inner - rightWidth - 2 : inner;
  const left = hintSegments(fitHints(hints, Math.max(0, room)));
  const gap = inner - segmentsWidth(left) - rightWidth;
  return [{ text: " " }, ...left, { text: spaces(gap) }, ...right, { text: " " }];
}

export function Footer({
  hints,
  columns,
  toast,
}: {
  hints: readonly Hint[];
  columns: number;
  toast?: Toast;
}) {
  return <Line segments={footerSegments(hints, columns, toast)} width={columns} />;
}
