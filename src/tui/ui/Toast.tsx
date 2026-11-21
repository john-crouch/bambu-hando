// ABOUTME: A toast ("✓ 3 labels sent to DYMO"): a short outcome in its tone's color, icon from the tone.
// ABOUTME: Frame draws it as the body's whole last row, on a quiet bar, so it never takes the footer's keys away.

import { Line } from "./Line.js";
import { type Segment, truncate } from "./text.js";
import { COLORS, ICONS } from "./theme.js";

export interface Toast {
  /** The message alone; the icon (✓ ! ✗) comes from the tone. */
  text: string;
  /** Default ok. */
  tone?: "ok" | "warning" | "failed";
}

const TOAST_ICONS = { ok: ICONS.ok, warning: ICONS.warning, failed: ICONS.failed } as const;

/** ` ✓ Saved `: the toast within room columns, a space each side; nothing below 5 columns. */
export function toastSegments(toast: Toast, room: number): Segment[] {
  if (room < 5) return [];
  const tone = toast.tone ?? "ok";
  const text = truncate(`${TOAST_ICONS[tone]} ${toast.text}`, room - 2);
  return [{ text: " " }, { text, color: COLORS[tone], bold: true }, { text: " " }];
}

/** The toast as one whole row of width columns on the toast bar: nothing under it shows beside it. */
export function ToastLine({ toast, width }: { toast: Toast; width: number }) {
  const bar = { backgroundColor: COLORS.toast };
  const segments = toastSegments(toast, width).map((segment) => ({ ...segment, ...bar }));
  return <Line segments={segments} width={width} fill={bar} />;
}
