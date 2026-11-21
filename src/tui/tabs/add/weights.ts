// ABOUTME: The Add tab's empty spool weight choices per brand: SpoolEase's rows, then the source's weight and unspecified.
// ABOUTME: Pure items; the weights page asks only for brands SpoolEase's lists don't settle.

import type { FilamentProfile } from "../../../models.js";
import {
  describeSourceWeights,
  type WeightChoice,
  type WeightGroup,
} from "../../../spoolWeights.js";
import { SPOOLMANDB_LABEL } from "./catalog.js";

export interface WeightItem {
  label: string;
  detail: string;
  choice: WeightChoice;
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
    label: option.label,
    detail: `${option.grams} g${option.mine ? " · My Spools List" : ""}`,
    choice: { kind: "grams", grams: option.grams },
  }));
  return [
    ...rows,
    {
      label: sourceName,
      detail: describeSourceWeights(profiles, group),
      choice: { kind: "source" },
    },
    {
      label: "Unspecified",
      detail: "SpoolEase works it out on the first full weigh",
      choice: { kind: "unspecified" },
    },
  ];
}

/** The item matching an earlier choice, so coming back shows what was picked; else the first. */
export function itemIndex(items: WeightItem[], choice: WeightChoice | undefined): number {
  if (!choice) return 0;
  const index = items.findIndex((item) => JSON.stringify(item.choice) === JSON.stringify(choice));
  return Math.max(0, index);
}

/** Where a brand's filaments come from, as the label of the "source's weight" item. */
export function weightSourceName(origins: ("db" | "import")[], importName: string | null): string {
  const names = [
    ...(origins.includes("db") ? [SPOOLMANDB_LABEL] : []),
    ...(origins.includes("import") ? [importName ?? "Imported file"] : []),
  ];
  return names.join(" and ") || SPOOLMANDB_LABEL;
}
