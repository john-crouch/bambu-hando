// ABOUTME: The pages inside a tab as one line, `✓ Find ─ ▸ Weights ─ Review`: done, current in accent, still to do.
// ABOUTME: When the whole bar doesn't fit with a column to spare, only the current page and its position show.

import { Line } from "./Line.js";
import { type Segment, segmentsWidth } from "./text.js";
import { COLORS, ICONS } from "./theme.js";

export interface Page {
  id: string;
  title: string;
  state: "done" | "current" | "todo" | "disabled";
  badge?: string | number;
}

function pageSegments(page: Page): Segment[] {
  const badge: Segment[] =
    page.badge !== undefined && page.badge !== "" && page.badge !== 0
      ? [{ text: ` ${page.badge}`, color: COLORS.warning, bold: true }]
      : [];
  switch (page.state) {
    case "done":
      return [{ text: `${ICONS.ok} `, color: COLORS.ok }, { text: page.title }, ...badge];
    case "current":
      return [
        { text: `${ICONS.current} ${page.title}`, color: COLORS.accent, bold: true },
        ...badge,
      ];
    case "disabled":
      return [{ text: page.title, color: COLORS.muted, dim: true }];
    default:
      return [{ text: page.title, color: COLORS.muted }, ...badge];
  }
}

const SEPARATOR: Segment = { text: " ─ ", color: COLORS.muted, dim: true };
const MORE: Segment = { text: "…", color: COLORS.muted };

function joined(pages: readonly Page[], separator: Segment = SEPARATOR): Segment[] {
  return pages.flatMap((page, index) => [...(index > 0 ? [separator] : []), ...pageSegments(page)]);
}

/** Pages from..to (inclusive) with … where pages were left out, and the current one's position. */
function windowSegments(pages: readonly Page[], from: number, to: number, at: number): Segment[] {
  return [
    ...(from > 0 ? [MORE, SEPARATOR] : []),
    ...joined(pages.slice(from, to + 1)),
    ...(to < pages.length - 1 ? [SEPARATOR, MORE] : []),
    { text: `  ${at + 1}/${pages.length}`, color: COLORS.muted },
  ];
}

/**
 * The widest run of pages around the current one that fits width with a space at each end, taking
 * the next page on the right first, then on the left; null when only the current page would show.
 */
function pageWindow(pages: readonly Page[], at: number, width: number): Segment[] | null {
  const fits = (from: number, to: number) =>
    segmentsWidth(windowSegments(pages, from, to, at)) + 2 <= width;
  let from = at;
  let to = at;
  for (let grew = true; grew; ) {
    grew = false;
    if (to < pages.length - 1 && fits(from, to + 1)) {
      to++;
      grew = true;
    }
    if (from > 0 && fits(from - 1, to)) {
      from--;
      grew = true;
    }
  }
  return from === to ? null : windowSegments(pages, from, to, at);
}

/**
 * The bar's segments for width columns: every page joined with ─ when that fits with a space at each
 * end (so the last page never touches a border), else the current page and its position.
 */
export function pageBarSegments(pages: readonly Page[], width: number): Segment[] {
  const lead: Segment = { text: " " };
  const full = joined(pages);
  if (segmentsWidth(full) + 2 <= width) return [lead, ...full];
  const at = pages.findIndex((page) => page.state === "current");
  const current = pages[at];
  if (!current) return [lead, ...full];
  const window = pageWindow(pages, at, width);
  if (window) return [lead, ...window];
  return [
    lead,
    ...pageSegments(current),
    { text: `  ${at + 1}/${pages.length}`, color: COLORS.muted },
  ];
}

export function PageBar({ pages, width }: { pages: readonly Page[]; width: number }) {
  return <Line segments={pageBarSegments(pages, width)} width={width} />;
}
