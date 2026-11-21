// ABOUTME: Text fitting for the design system: widths measured as Ink measures them, cuts ending in …, padding.
// ABOUTME: Components build every line to an exact width with these, so nothing is ever wider than its width prop.

import stringWidth from "string-width";

export type Align = "left" | "right";

/** A styled piece of a line. Components draw each as one <Text>. */
export interface Segment {
  text: string;
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  dim?: boolean;
  underline?: boolean;
  inverse?: boolean;
}

export const ELLIPSIS = "…";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Columns the text takes on screen, as Ink measures it (ANSI codes count for nothing). */
export function textWidth(text: string): number {
  return stringWidth(text);
}

/** The longest start of text that fits in width columns, whole characters only. */
function head(text: string, width: number): string {
  let out = "";
  let used = 0;
  for (const { segment } of graphemes.segment(text)) {
    const w = stringWidth(segment);
    if (used + w > width) break;
    out += segment;
    used += w;
  }
  return out;
}

/** The text when it fits; else cut so that it ends in … and still fits. Never wider than width. */
export function truncate(text: string, width: number): string {
  if (width <= 0) return "";
  if (stringWidth(text) <= width) return text;
  return `${head(text, width - 1).trimEnd()}${ELLIPSIS}`;
}

/** Spaces, never a negative count. */
export function spaces(count: number): string {
  return " ".repeat(Math.max(0, count));
}

/** The text cut to width and padded to exactly width columns. */
export function fitText(text: string, width: number, align: Align = "left"): string {
  if (width <= 0) return "";
  const cut = truncate(text, width);
  const pad = spaces(width - stringWidth(cut));
  return align === "right" ? pad + cut : cut + pad;
}

export function segmentsWidth(segments: readonly Segment[]): number {
  return segments.reduce((sum, segment) => sum + stringWidth(segment.text), 0);
}

/**
 * The segments cut to width: those that fit are kept as they are, the one at the edge ends in … in its
 * own style, the rest are dropped. Empty segments are dropped too. Not padded.
 */
export function fitSegments(segments: readonly Segment[], width: number): Segment[] {
  const kept = segments.filter((segment) => segment.text !== "");
  if (width <= 0) return [];
  if (segmentsWidth(kept) <= width) return kept;
  const out: Segment[] = [];
  let used = 0;
  for (const segment of kept) {
    const w = stringWidth(segment.text);
    // Room for the … is kept back from every segment until the last one that fits whole.
    if (used + w <= width - 1) {
      out.push(segment);
      used += w;
      continue;
    }
    const cut = head(segment.text, width - 1 - used).trimEnd();
    out.push({ ...segment, text: `${cut}${ELLIPSIS}` });
    break;
  }
  return out;
}

/** The segments cut and padded to exactly width columns; the padding takes the style `fill` gives. */
export function padSegments(
  segments: readonly Segment[],
  width: number,
  fill: Omit<Segment, "text"> = {},
): Segment[] {
  const cut = fitSegments(segments, width);
  const rest = width - segmentsWidth(cut);
  return rest > 0 ? [...cut, { ...fill, text: spaces(rest) }] : cut;
}

/** text broken into lines of at most width columns at spaces; a word wider than width gets a line of its own. */
export function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next) > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
