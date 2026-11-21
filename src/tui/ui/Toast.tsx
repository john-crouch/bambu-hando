// ABOUTME: A toast ("✓ 3 labels sent to DYMO"): a short outcome in its tone's color, icon from the tone.
// ABOUTME: Frame draws it over the body's last line, so it never takes the footer's keys away.

import { Line } from "./Line.js";
import { type Segment, textWidth, truncate } from "./text.js";
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

export function ToastLine({ toast, room }: { toast: Toast; room: number }) {
  const segments = toastSegments(toast, room);
  const width = segments.reduce((sum, segment) => sum + textWidth(segment.text), 0);
  return <Line segments={segments} width={width} />;
}
