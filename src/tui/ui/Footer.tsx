// ABOUTME: The footer line: the keys that work right now, primary ones kept when narrow, a toast at the right end.
// ABOUTME: A toast ("✓ 3 labels sent to DYMO") takes its room first; hints get what's left.

import type { Hint } from "../core/types.js";
import { fitHints, hintSegments } from "./hints.js";
import { Line } from "./Line.js";
import { type Segment, segmentsWidth, spaces, truncate } from "./text.js";
import { COLORS, ICONS } from "./theme.js";

export interface Toast {
  text: string;
  tone?: "ok" | "warning" | "failed";
}

const TOAST_ICONS = { ok: ICONS.ok, warning: ICONS.warning, failed: ICONS.failed } as const;

function toastSegments(toast: Toast | undefined, room: number): Segment[] {
  if (!toast || room < 3) return [];
  const color = toast.tone ? COLORS[toast.tone] : COLORS.accent;
  const icon = toast.tone ? `${TOAST_ICONS[toast.tone]} ` : "";
  return [{ text: truncate(`${icon}${toast.text}`, room), color, bold: true }];
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
