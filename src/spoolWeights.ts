// ABOUTME: Empty-spool weight choices per brand, from SpoolEase's built-in spool catalog and the user's own list.
// ABOUTME: Groups profiles by brand, matches catalog rows by brand and spool size, and applies the chosen weight.

import { errorMessage } from "./errors.js";
import type { FilamentProfile } from "./models.js";
import type { SpoolEaseClient } from "./spoolease.js";

/** One row of a SpoolEase spool weight list. */
export interface SpoolWeightEntry {
  label: string;
  grams: number;
  /** From the user's "My Spools List" rather than SpoolEase's catalog. */
  mine: boolean;
}

/** Profiles of one brand and the spool weight rows that fit them. */
export interface WeightGroup {
  key: string;
  brand: string;
  /** Indices into the profiles. */
  profiles: number[];
  /** Matching rows, the user's own first, one per weight. */
  options: SpoolWeightEntry[];
}

/** grams: a weight from a list or typed in; source: keep the source's (SpoolmanDB's) weight; unspecified: 0. */
export type WeightChoice = { kind: "grams"; grams: number } | { kind: "source" } | { kind: "unspecified" };

const DEFAULT_SIZE_G = 1000;

/** Brands compare by letters and digits only: "PolyMaker" and "Polymaker", "Devil Design" and "DevilDesign". */
export function brandKey(brand: string): string {
  return brand.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Parses name,grams pairs; SpoolEase's spool form reads its lists the same way, up to two pairs per line. */
export function parseSpoolWeightList(text: string, mine = false): SpoolWeightEntry[] {
  const entries: SpoolWeightEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const fields = line.split(",").map((field) => field.trim());
    for (let i = 0; i < fields.length - 1; i++) {
      const label = fields[i];
      const grams = Number.parseInt(fields[i + 1] ?? "", 10);
      if (label && !Number.isNaN(grams)) {
        entries.push({ label, grams, mine });
        i++;
      }
    }
  }
  return entries;
}

// Rows name their spool size only when it isn't 1 kg ("Sunlu 250g - Plastic - 55g", "PolyMaker 3kg - ...");
// the trailing " - 55g" is the spool's own weight.
function entrySize(label: string): number {
  const body = label.replace(/\s*-\s*\d+(?:\.\d+)?\s*g\s*$/i, "");
  const size = /\b(\d+(?:\.\d+)?)\s*(kg|g)\b/i.exec(body);
  if (!size) return DEFAULT_SIZE_G;
  return Number(size[1]) * (size[2]?.toLowerCase() === "kg" ? 1000 : 1);
}

export function weightGroups(profiles: FilamentProfile[], entries: SpoolWeightEntry[]): WeightGroup[] {
  const groups = new Map<string, WeightGroup>();
  for (const [index, profile] of profiles.entries()) {
    const key = brandKey(profile.brand);
    const group = groups.get(key) ?? { key, brand: profile.brand, profiles: [], options: [] };
    group.profiles.push(index);
    groups.set(key, group);
  }

  const ordered = [...entries.filter((e) => e.mine), ...entries.filter((e) => !e.mine)];
  for (const group of groups.values()) {
    if (!group.key) continue;
    const sizes = new Set(group.profiles.map((i) => profiles[i]?.labelWeight || DEFAULT_SIZE_G));
    const seen = new Set<number>();
    for (const entry of ordered) {
      if (!brandKey(entry.label).startsWith(group.key) || !sizes.has(entrySize(entry.label)) || seen.has(entry.grams)) continue;
      seen.add(entry.grams);
      group.options.push(entry);
    }
  }
  return [...groups.values()];
}

/** A single row is taken as is and no row keeps the source's weight; several rows need a choice (null). */
export function defaultChoice(group: WeightGroup): WeightChoice | null {
  if (group.options.length === 0) return { kind: "source" };
  if (group.options.length === 1) return { kind: "grams", grams: group.options[0]!.grams };
  return null;
}

/** Profiles with each brand's chosen weight; brands without a choice get their default, or keep their weight. */
export function applyWeights(
  profiles: FilamentProfile[],
  groups: WeightGroup[],
  choices: ReadonlyMap<string, WeightChoice>,
): FilamentProfile[] {
  const result = [...profiles];
  for (const group of groups) {
    const choice = choices.get(group.key) ?? defaultChoice(group) ?? { kind: "source" };
    if (choice.kind === "source") continue;
    for (const index of group.profiles) {
      const profile = result[index];
      if (profile) result[index] = { ...profile, coreWeight: choice.kind === "grams" ? choice.grams : 0 };
    }
  }
  return result;
}

/** The source's weights for a brand: "140 g", a range when its filaments disagree, or "unknown". */
export function describeSourceWeights(profiles: FilamentProfile[], group: WeightGroup): string {
  const weights = group.profiles.map((i) => profiles[i]?.coreWeight ?? 0).filter((w) => w > 0);
  if (weights.length === 0) return "unknown";
  const low = Math.min(...weights);
  const high = Math.max(...weights);
  return low === high ? `${low} g` : `${low}–${high} g`;
}

/** Parses a --spool-weight value: <brand>=<grams|spoolmandb|unspecified>. */
export function parseSpoolWeightArg(arg: string): { key: string; brand: string; choice: WeightChoice } {
  const at = arg.lastIndexOf("=");
  const brand = arg.slice(0, at).trim();
  const value = arg.slice(at + 1).trim().toLowerCase();
  let choice: WeightChoice | null = null;
  if (value === "spoolmandb") choice = { kind: "source" };
  else if (value === "unspecified") choice = { kind: "unspecified" };
  else if (/^\d+$/.test(value)) choice = { kind: "grams", grams: Number(value) };
  if (at < 0 || !brandKey(brand) || !choice) {
    throw new Error(`--spool-weight takes <brand>=<grams|spoolmandb|unspecified>, got "${arg}"`);
  }
  return { key: brandKey(brand), brand, choice };
}

/** SpoolEase's catalog plus the user's own list; a list that can't be read becomes a warning. */
export async function readSpoolWeights(client: SpoolEaseClient): Promise<{ entries: SpoolWeightEntry[]; warnings: string[] }> {
  const entries: SpoolWeightEntry[] = [];
  const warnings: string[] = [];
  try {
    entries.push(...parseSpoolWeightList(await client.getMySpoolWeights(), true));
  } catch (err) {
    warnings.push(`Couldn't read My Spools List from SpoolEase: ${errorMessage(err)}`);
  }
  try {
    entries.push(...parseSpoolWeightList(await client.getSpoolsCatalog()));
  } catch (err) {
    warnings.push(`Couldn't read the spool catalog from SpoolEase: ${errorMessage(err)}`);
  }
  return { entries, warnings };
}
