// ABOUTME: The pages inside a tab as one line, `✓ Find ─ ▸ Weights ─ Review`: done, current in accent, still to do.
// ABOUTME: Narrow terminals lose the separators, then everything but the current page and its position.

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

function joined(pages: readonly Page[], separator: Segment): Segment[] {
  return pages.flatMap((page, index) => [...(index > 0 ? [separator] : []), ...pageSegments(page)]);
}

/** The bar's segments for width columns: the fullest form that fits, cut with … as the last resort. */
export function pageBarSegments(pages: readonly Page[], width: number): Segment[] {
  const lead: Segment = { text: " " };
  const forms = [
    joined(pages, { text: " ─ ", color: COLORS.muted, dim: true }),
    joined(pages, { text: "  " }),
  ];
  for (const form of forms) if (segmentsWidth(form) + 1 <= width) return [lead, ...form];
  const at = pages.findIndex((page) => page.state === "current");
  const current = pages[at];
  if (!current) return [lead, ...(forms[1] ?? [])];
  return [
    lead,
    ...pageSegments(current),
    { text: `  ${at + 1}/${pages.length}`, color: COLORS.muted },
  ];
}

export function PageBar({ pages, width }: { pages: readonly Page[]; width: number }) {
  return <Line segments={pageBarSegments(pages, width)} width={width} />;
}
