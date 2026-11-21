// ABOUTME: The Add tab's empty spool weight choices per brand: SpoolEase's rows, then the source's weight and unspecified.
// ABOUTME: Pure items; the weights page asks only for brands SpoolEase's lists don't settle.

import type { FilamentProfile } from "../../../models.js";
import {
  describeSourceWeights,
  type WeightChoice,
  type WeightGroup,
} from "../../../spoolWeights.js";
import { formatGrams } from "../../ui/format.js";
import { SPOOLMANDB_LABEL } from "./catalog.js";

export interface WeightItem {
  label: string;
  /** The weight it gives, for people: "137 g", "140–250 g", "unknown", "–" (none). */
  weight: string;
  /** Where the weight comes from, a sentence for the detail panel. */
  detail: string;
  choice: WeightChoice;
}

/** A row's name without the grams at its end ("PolyMaker - Cardboard - 137g"), since the weight has its own column. */
function withoutGrams(label: string, grams: number): string {
  const match = /\s*[-–·,]?\s*(\d+)\s*g$/i.exec(label);
  if (!match || Number(match[1]) !== grams) return label;
  const rest = label.slice(0, match.index).trim();
  return rest || label;
}

/**
 * The brand's rows, then the source's weight and unspecified, which are always offered: when the spool
 * in hand matches no row, SpoolEase can still work its weight out on the first full weigh.
 */
export function weightItems(
  group: WeightGroup,
  profiles: FilamentProfile[],
  sourceName: string,
): WeightItem[] {
  const rows: WeightItem[] = group.options.map((option) => ({
    label: withoutGrams(option.label, option.grams),
    weight: formatGrams(option.grams),
    detail: option.mine
      ? "From your My Spools List on SpoolEase."
      : `From SpoolEase's spool catalog: ${option.label}.`,
    choice: { kind: "grams", grams: option.grams },
  }));
  return [
    ...rows,
    {
      label: `As listed in ${sourceName}`,
      weight: describeSourceWeights(profiles, group),
      detail: `The empty spool weight ${sourceName} gives for these filaments.`,
      choice: { kind: "source" },
    },
    {
      label: "Unspecified",
      weight: "–",
      detail: "SpoolEase works it out on the first full weigh.",
      choice: { kind: "unspecified" },
    },
  ];
}

/** The item matching an earlier choice, so coming back shows what was picked; else the source's weight. */
export function itemIndex(items: WeightItem[], choice: WeightChoice | undefined): number {
  const source = Math.max(
    0,
    items.findIndex((item) => item.choice.kind === "source"),
  );
  if (!choice) return source;
  const index = items.findIndex((item) => JSON.stringify(item.choice) === JSON.stringify(choice));
  return index < 0 ? source : index;
}

/** Where a brand's filaments come from, as the label of the "source's weight" item. */
export function weightSourceName(origins: ("db" | "import")[], importName: string | null): string {
  const names = [
    ...(origins.includes("db") ? [SPOOLMANDB_LABEL] : []),
    ...(origins.includes("import") ? [importName ?? "Imported file"] : []),
  ];
  return names.join(" and ") || SPOOLMANDB_LABEL;
}
