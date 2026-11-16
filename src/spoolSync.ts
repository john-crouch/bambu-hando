// ABOUTME: Plans and applies a spool sync between SpoolEase and 3DFilamentProfiles: links, weights, tags and new 3DFP spools.
// ABOUTME: SpoolEase's weight can't be written from outside its scale, so 3DFP only ever receives weights; the plan says when to weigh.

import { QuotaError } from "./apiQuota.js";
import { errorMessage } from "./errors.js";
import type { FilamentProfilesClient, SpoolPatch, TdfpFilament, TdfpSpool } from "./filamentProfiles.js";
import type { SpoolRecord } from "./spoolease.js";
import { remainingGrams } from "./spoolInventory.js";
import type { SpoolLink } from "./spoolLinks.js";

/** Weights closer than this count as the same: scales and rounding wobble by a few grams. */
export const WEIGHT_TOLERANCE_G = 5;
/** The most remaining_grams the 3DFilamentProfiles API takes. */
const MAX_GRAMS = 10_000;

export type WeightVerdict =
  /** Both sides have the same filament left. */
  | { kind: "agree" }
  /** 3DFP gets SpoolEase's weight. */
  | { kind: "push"; grams: number }
  /** 3DFP's weight should win, but only SpoolEase's scale can set its weight. */
  | { kind: "weigh" }
  /** SpoolEase hasn't weighed the spool, so there's nothing to compare. */
  | { kind: "unweighed" };

/**
 * Compares against the weights both sides last agreed on: the side that changed since wins; when both changed,
 * the lower weight wins, since filament only gets used up. Before they ever agreed, SpoolEase's scale wins: lower
 * wins would ask forever for a weigh that can't change a correct reading whenever 3DFP's number is lower.
 */
export function weightVerdict(agreed: SpoolLink["agreed"], spoolease: number | null, tdfp: number): WeightVerdict {
  if (spoolease === null) return { kind: "unweighed" };
  const grams = Math.min(MAX_GRAMS, spoolease);
  if (Math.abs(grams - tdfp) < WEIGHT_TOLERANCE_G) return { kind: "agree" };
  const moved = (now: number, then: number) => Math.abs(now - then) >= WEIGHT_TOLERANCE_G;
  if (agreed === null) return { kind: "push", grams };
  const spooleaseMoved = moved(grams, agreed.spoolease);
  const tdfpMoved = moved(tdfp, agreed.tdfp);
  if (!spooleaseMoved) return { kind: "weigh" };
  if (!tdfpMoved || grams < tdfp) return { kind: "push", grams };
  return { kind: "weigh" };
}

/** Letters and digits only, lower case: "Sunlu" = "SUNLU", "2.0 Vivid Yellow" = "20vividyellow". */
const squash = (text: string | null | undefined): string => (text ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Either color name contains the other once squashed, so "2.0 Vivid Yellow" fits "Vivid Yellow" of type "2.0". */
function colorsFit(spool: SpoolRecord, color: string, materialType: string | null): boolean {
  const theirs = squash(color);
  const ours = squash(spool.colorName);
  if (!theirs || !ours) return false;
  return squash(`${spool.subtype} ${spool.colorName}`).includes(theirs) || squash(`${materialType ?? ""} ${color}`).includes(ours);
}

/** Same brand, material and color, by name. */
export function spoolsMatch(spool: SpoolRecord, tdfp: TdfpSpool): boolean {
  return squash(spool.brand) === squash(tdfp.brand) && squash(spool.material) === squash(tdfp.material) && colorsFit(spool, tdfp.color, tdfp.materialType);
}

/** The filaments a SpoolEase spool could be added to 3DFP as: same brand, material and color. */
export function addCandidates(spool: SpoolRecord, filaments: TdfpFilament[]): TdfpFilament[] {
  return filaments.filter(
    (f) => squash(spool.brand) === squash(f.brandName) && squash(spool.material) === squash(f.material) && colorsFit(spool, f.color, f.materialType),
  );
}

export type SyncRow =
  /** A linked pair, already ("kept"), by name ("matched") or as asked ("chosen"); patch is what 3DFP gets. */
  | {
      kind: "linked";
      how: "kept" | "matched" | "chosen";
      spool: SpoolRecord;
      tdfp: TdfpSpool;
      before: SpoolLink | null;
      after: SpoolLink;
      weight: WeightVerdict;
      patch: SpoolPatch | null;
    }
  /** A new 3DFP spool for a SpoolEase one; grams null leaves it at the filament's own weight. */
  | { kind: "add"; spool: SpoolRecord; chosen: boolean; filamentId: number; filament: TdfpFilament | null; grams: number | null; tag: string | null }
  | { kind: "unlinked"; link: SpoolLink; spool: SpoolRecord | null; tdfp: TdfpSpool | null; reason: "asked" | "replaced" | "spoolease-gone" | "tdfp-gone" }
  /** Several 3DFP spools fit, or the one that fits fits other SpoolEase spools too. */
  | { kind: "ambiguous"; spool: SpoolRecord; candidates: TdfpSpool[] }
  /** No 3DFP spool fits, and the catalog has none or several filaments to add it as. */
  | { kind: "suggest"; spool: SpoolRecord; filaments: TdfpFilament[] }
  | { kind: "tdfp-only"; tdfp: TdfpSpool };

export interface SyncPlan {
  rows: SyncRow[];
  /** API calls applying it takes. */
  calls: number;
  /** Rows that change something the user would notice: links made or removed, 3DFP writes. */
  changes: number;
  /** When it was planned: new links are dated with it. */
  now: Date;
}

export interface SyncChoices {
  /** SpoolEase id → 3DFP short code. */
  link?: Map<string, string>;
  /** SpoolEase id → 3DFP filament id. */
  add?: Map<string, number>;
  /** SpoolEase ids. */
  unlink?: Set<string>;
}

export interface SyncInput {
  spoolease: SpoolRecord[];
  tdfp: TdfpSpool[];
  links: SpoolLink[];
  choices?: SyncChoices;
  /** Catalog filaments that might be this spool's (the planner filters them). */
  filamentsFor?: (spool: SpoolRecord) => TdfpFilament[];
  /** A catalog filament by id, for a chosen add. */
  filamentById?: (id: number) => TdfpFilament | null;
  now: Date;
}

/** A choice that doesn't fit the spools; nothing was planned. */
export class SyncPlanError extends Error {}

export function rowCalls(row: SyncRow): number {
  if (row.kind === "linked") return row.patch ? 1 : 0;
  if (row.kind === "add") return row.tag ? 2 : 1;
  return 0;
}

function rowChanges(row: SyncRow): boolean {
  return (row.kind === "linked" && (row.before === null || row.patch !== null)) || row.kind === "add" || row.kind === "unlinked";
}

const byId = (a: SpoolRecord, b: SpoolRecord) => Number(a.id) - Number(b.id) || a.id.localeCompare(b.id);

function linkedRow(spool: SpoolRecord, tdfp: TdfpSpool, before: SpoolLink | null, how: "kept" | "matched" | "chosen", now: Date): SyncRow {
  const left = remainingGrams(spool);
  const weight = weightVerdict(before?.agreed ?? null, left, tdfp.remainingGrams);
  const patch: SpoolPatch = {};
  let agreed = before?.agreed ?? null;
  if (weight.kind === "push") {
    patch.remainingGrams = weight.grams;
    agreed = { spoolease: weight.grams, tdfp: weight.grams };
  } else if (weight.kind === "agree" && left !== null) {
    agreed = { spoolease: left, tdfp: tdfp.remainingGrams };
  }
  let tag = before?.tag ?? null;
  if (spool.tagId && spool.tagId !== tag) {
    patch.bambuTagId = spool.tagId;
    tag = spool.tagId;
  }
  const after: SpoolLink = { spoolease: spool.id, tdfp: tdfp.shortCode, agreed, tag, linkedAt: before?.linkedAt ?? now.toISOString() };
  return { kind: "linked", how, spool, tdfp, before, after, weight, patch: Object.keys(patch).length ? patch : null };
}

function addRow(spool: SpoolRecord, filamentId: number, filament: TdfpFilament | null, chosen: boolean): SyncRow {
  const left = remainingGrams(spool);
  return { kind: "add", spool, chosen, filamentId, filament, grams: left === null ? null : Math.min(MAX_GRAMS, left), tag: spool.tagId || null };
}

/** What a sync would do, row by row: dropped links first, then SpoolEase spools by id, then 3DFP spools nothing fits. */
export function planSync(input: SyncInput): SyncPlan {
  const seById = new Map(input.spoolease.map((spool) => [spool.id, spool]));
  const tdByCode = new Map(input.tdfp.map((spool) => [spool.shortCode, spool]));
  const chosenLinks = input.choices?.link ?? new Map<string, string>();
  const chosenAdds = input.choices?.add ?? new Map<string, number>();
  const unlinks = input.choices?.unlink ?? new Set<string>();

  const chosenCodes = new Set<string>();
  for (const [id, code] of chosenLinks) {
    if (!seById.has(id)) throw new SyncPlanError(`SpoolEase has no spool #${id}`);
    if (!tdByCode.has(code)) throw new SyncPlanError(`3DFilamentProfiles has no spool ${code}`);
    if (chosenCodes.has(code)) throw new SyncPlanError(`3DFilamentProfiles spool ${code} can't be linked to two SpoolEase spools`);
    chosenCodes.add(code);
  }
  for (const id of chosenAdds.keys()) {
    if (!seById.has(id)) throw new SyncPlanError(`SpoolEase has no spool #${id}`);
    if (chosenLinks.has(id)) throw new SyncPlanError(`#${id} can't be both linked and added`);
    const linked = input.links.find((link) => link.spoolease === id);
    if (linked && !unlinks.has(id)) throw new SyncPlanError(`#${id} is already linked to ${linked.tdfp}: --unlink ${id} first`);
  }
  for (const id of unlinks) if (!input.links.some((link) => link.spoolease === id)) throw new SyncPlanError(`#${id} isn't linked`);

  const dropped: SyncRow[] = [];
  const bySpool = new Map<string, SyncRow>();
  const takenCodes = new Set<string>();
  const settled = new Set<string>();

  for (const link of input.links) {
    const spool = seById.get(link.spoolease) ?? null;
    const tdfp = tdByCode.get(link.tdfp) ?? null;
    const reason = unlinks.has(link.spoolease)
      ? "asked"
      : chosenLinks.has(link.spoolease) || chosenCodes.has(link.tdfp)
        ? "replaced"
        : !spool
          ? "spoolease-gone"
          : !tdfp
            ? "tdfp-gone"
            : null;
    if (reason === null && spool && tdfp) {
      bySpool.set(spool.id, linkedRow(spool, tdfp, link, "kept", input.now));
      takenCodes.add(tdfp.shortCode);
      continue;
    }
    dropped.push({ kind: "unlinked", link, spool: null, tdfp: null, reason: reason ?? "spoolease-gone" });
    if (reason === "asked") settled.add(link.spoolease);
  }
  for (const [id, code] of chosenLinks) {
    const spool = seById.get(id);
    const tdfp = tdByCode.get(code);
    if (!spool || !tdfp) continue;
    bySpool.set(id, linkedRow(spool, tdfp, null, "chosen", input.now));
    takenCodes.add(code);
  }
  for (const [id, filamentId] of chosenAdds) {
    const spool = seById.get(id);
    if (spool) bySpool.set(id, addRow(spool, filamentId, input.filamentById?.(filamentId) ?? null, true));
  }

  const open = input.spoolease.filter((spool) => !bySpool.has(spool.id) && !settled.has(spool.id));
  const freeTdfp = input.tdfp.filter((spool) => !takenCodes.has(spool.shortCode));
  const fits = new Map(open.map((spool) => [spool.id, freeTdfp.filter((tdfp) => spoolsMatch(spool, tdfp))]));
  const wanted = new Map<string, number>();
  for (const candidates of fits.values()) for (const tdfp of candidates) wanted.set(tdfp.shortCode, (wanted.get(tdfp.shortCode) ?? 0) + 1);
  const claimed = new Set<string>();
  for (const spool of open) {
    const candidates = fits.get(spool.id) ?? [];
    const only = candidates[0];
    if (candidates.length === 1 && only && wanted.get(only.shortCode) === 1) {
      bySpool.set(spool.id, linkedRow(spool, only, null, "matched", input.now));
      claimed.add(only.shortCode);
    } else if (candidates.length > 0) {
      bySpool.set(spool.id, { kind: "ambiguous", spool, candidates });
      for (const tdfp of candidates) claimed.add(tdfp.shortCode);
    } else {
      const filaments = addCandidates(spool, input.filamentsFor?.(spool) ?? []);
      const one = filaments[0];
      bySpool.set(spool.id, filaments.length === 1 && one ? addRow(spool, one.id, one, false) : { kind: "suggest", spool, filaments });
    }
  }

  const spoolRows = [...input.spoolease]
    .sort(byId)
    .map((spool) => bySpool.get(spool.id))
    .filter((row): row is SyncRow => row !== undefined);
  const tdfpOnly: SyncRow[] = freeTdfp.filter((tdfp) => !claimed.has(tdfp.shortCode)).map((tdfp) => ({ kind: "tdfp-only", tdfp }));
  const rows = [...dropped, ...spoolRows, ...tdfpOnly];
  return { rows, calls: rows.reduce((sum, row) => sum + rowCalls(row), 0), changes: rows.filter(rowChanges).length, now: input.now };
}

export interface RowOutcome {
  row: SyncRow;
  ok: boolean;
  error: string | null;
  /** add: the new 3DFP spool's short code. */
  created?: string;
}

export interface AppliedSync {
  /** The links to keep: what was sent, or what was already there for rows whose calls failed. */
  links: SpoolLink[];
  /** One per row that needed API calls. */
  outcomes: RowOutcome[];
}

/** Sends the plan's 3DFP writes one at a time; a failed row doesn't stop the others, a used-up quota stops all calls. */
export async function applySync(plan: SyncPlan, client: FilamentProfilesClient, onRow: (outcome: RowOutcome) => void = () => {}): Promise<AppliedSync> {
  const links: SpoolLink[] = [];
  const outcomes: RowOutcome[] = [];
  let quotaGone: string | null = null;
  const report = (outcome: RowOutcome) => {
    outcomes.push(outcome);
    onRow(outcome);
  };
  const failed = (err: unknown): string => {
    if (err instanceof QuotaError) quotaGone = err.message;
    return errorMessage(err);
  };

  for (const row of plan.rows) {
    if (row.kind === "linked") {
      if (!row.patch) {
        links.push(row.after);
        continue;
      }
      if (quotaGone) {
        links.push({ ...row.after, agreed: row.before?.agreed ?? null, tag: row.before?.tag ?? null });
        report({ row, ok: false, error: quotaGone });
        continue;
      }
      try {
        await client.updateSpool(row.tdfp.shortCode, row.patch);
        links.push(row.after);
        report({ row, ok: true, error: null });
      } catch (err) {
        links.push({ ...row.after, agreed: row.before?.agreed ?? null, tag: row.before?.tag ?? null });
        report({ row, ok: false, error: failed(err) });
      }
    } else if (row.kind === "add") {
      if (quotaGone) {
        report({ row, ok: false, error: quotaGone });
        continue;
      }
      let code: string;
      try {
        const added = await client.addSpool({ filamentId: row.filamentId, ...(row.grams === null ? {} : { remainingGrams: row.grams }) });
        if (!added.created) throw new Error("3DFilamentProfiles created no spool");
        code = added.spool.shortCode;
      } catch (err) {
        report({ row, ok: false, error: failed(err) });
        continue;
      }
      const link: SpoolLink = {
        spoolease: row.spool.id,
        tdfp: code,
        agreed: row.grams === null ? null : { spoolease: row.grams, tdfp: row.grams },
        tag: null,
        linkedAt: plan.now.toISOString(),
      };
      let error: string | null = null;
      if (row.tag) {
        try {
          if (quotaGone) throw new QuotaError(quotaGone);
          await client.updateSpool(code, { bambuTagId: row.tag });
          link.tag = row.tag;
        } catch (err) {
          error = `added as ${code}, but its tag wasn't written: ${failed(err)}`;
        }
      }
      links.push(link);
      report({ row, ok: error === null, error, created: code });
    }
  }
  return { links, outcomes };
}
