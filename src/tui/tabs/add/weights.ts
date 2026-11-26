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
  /** Which list the row is from, short, for the row itself: "your list", "catalog", or "" (not a list's). */
  origin: "your list" | "catalog" | "";
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
 * The catalog's rows of one name together, lightest first, numbered apart ("Sunlu - Plastic, 1 of 3"):
 * the catalog names them alike, and a list of identical names reads as the same row repeated.
 */
function apart(rows: WeightItem[]): WeightItem[] {
  const alike = (row: WeightItem) =>
    row.origin === "catalog" &&
    rows.filter((r) => r.origin === "catalog" && r.label === row.label).length > 1;
  const grams = (row: WeightItem) => (row.choice.kind === "grams" ? row.choice.grams : 0);
  const out: WeightItem[] = [];
  for (const row of rows) {
    if (!alike(row)) {
      out.push(row);
      continue;
    }
    if (out.some((r) => r.origin === "catalog" && r.label.startsWith(`${row.label}, `))) continue;
    const twins = rows
      .filter((r) => r.origin === "catalog" && r.label === row.label)
      .sort((a, b) => grams(a) - grams(b));
    out.push(
      ...twins.map((twin, index) => ({
        ...twin,
        label: `${twin.label}, ${index + 1} of ${twins.length}`,
      })),
    );
  }
  return out;
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
  const labels = group.options.map((option) => withoutGrams(option.label, option.grams));
  const rows: WeightItem[] = group.options.map((option, index) => {
    const label = labels[index] ?? option.label;
    // The catalog names some spools alike ("Sunlu - Plastic" at 117 g and 150 g): only the scale tells them apart.
    const alike = group.options.filter((o, i) => !o.mine && labels[i] === label);
    const twins =
      !option.mine && alike.length > 1
        ? ` It has more than one ${label} (${alike
            .map((o) => o.grams)
            .sort((a, b) => a - b)
            .map(formatGrams)
            .join(", ")}): weigh an empty spool to tell which is yours.`
        : "";
    return {
      label,
      weight: formatGrams(option.grams),
      detail: option.mine
        ? "From your My Spools List on SpoolEase."
        : `From SpoolEase's spool catalog: ${option.label}.${twins}`,
      origin: option.mine ? "your list" : "catalog",
      choice: { kind: "grams", grams: option.grams },
    };
  });
  return [
    ...apart(rows),
    {
      label: `As listed in ${sourceName}`,
      weight: describeSourceWeights(profiles, group),
      detail: `The empty spool weight ${sourceName} gives for these filaments.`,
      origin: "",
      choice: { kind: "source" },
    },
    {
      label: "Unspecified",
      weight: "–",
      detail: "SpoolEase works it out on the first full weigh.",
      origin: "",
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
