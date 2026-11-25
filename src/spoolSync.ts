// ABOUTME: Plans and applies a spool sync between SpoolEase and 3DFilamentProfiles: links, weights, tags and new 3DFP spools.
// ABOUTME: SpoolEase's weight can't be written from outside its scale, so 3DFP only ever receives weights; the plan says when to weigh.

import { QuotaError } from "./apiQuota.js";
import { errorMessage } from "./errors.js";
import {
  type AddedSpool,
  type BulkSpoolResult,
  type FilamentProfilesClient,
  MAX_BULK_UPDATES,
  type SpoolPatch,
  type TdfpFilament,
  type TdfpSpool,
} from "./filamentProfiles.js";
import type { SpoolRecord } from "./spoolease.js";
import { remainingGrams } from "./spoolInventory.js";
import { externalIdFor, externalIdIsOurs, type SpoolLink } from "./spoolLinks.js";

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
export function weightVerdict(
  agreed: SpoolLink["agreed"],
  spoolease: number | null,
  tdfp: number,
): WeightVerdict {
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
const squash = (text: string | null | undefined): string =>
  (text ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** How far apart (per RGB channel, 0-255) two color codes may be and still be the same color. */
export const COLOR_TOLERANCE = 24;

function rgbOf(code: string | null | undefined): number[] | null {
  const hex = (code ?? "").replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(hex)) return null;
  return [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
}

/** One of the spool's color codes is within COLOR_TOLERANCE of `rgb`; false when either side has none. */
function codesAgree(spool: SpoolRecord, rgb: string | null): boolean {
  const theirs = rgbOf(rgb);
  if (!theirs) return false;
  return spool.colorCodes.some((code) => {
    const ours = rgbOf(code);
    return (
      ours?.every((channel, i) => Math.abs(channel - (theirs[i] ?? 0)) <= COLOR_TOLERANCE) === true
    );
  });
}

/**
 * The same color once squashed, with or without each side's type in front ("Vivid Yellow" of type "2.0" fits
 * "2.0 Vivid Yellow"). SpoolEase's name may also have extra words of its own, as SpoolmanDB product names carry the
 * line while 3DFP's spool list often has no type, but only when the color codes agree too: names alone can't tell
 * "2.0 Vivid Yellow" from "Matte Black" vs "Black". Extra words on 3DFP's side never fit, so "Black" isn't "Matte Black".
 */
function colorsFit(
  spool: SpoolRecord,
  color: string,
  materialType: string | null,
  rgb: string | null,
): boolean {
  const theirs = squash(color);
  const ours = squash(spool.colorName);
  if (!theirs || !ours) return false;
  const oursNamed = [ours, squash(`${spool.subtype} ${spool.colorName}`)];
  const theirsNamed = [theirs, squash(`${materialType ?? ""} ${color}`)];
  if (theirsNamed.some((name) => oursNamed.includes(name))) return true;
  return (
    oursNamed.some((name) => theirsNamed.some((other) => name.includes(other))) &&
    codesAgree(spool, rgb)
  );
}

/** Same brand, material and color, by name. */
export function spoolsMatch(spool: SpoolRecord, tdfp: TdfpSpool): boolean {
  return (
    squash(spool.brand) === squash(tdfp.brand) &&
    squash(spool.material) === squash(tdfp.material) &&
    colorsFit(spool, tdfp.color, tdfp.materialType, tdfp.rgb)
  );
}

/** The filaments a SpoolEase spool could be added to 3DFP as: same brand, material and color. */
export function addCandidates(spool: SpoolRecord, filaments: TdfpFilament[]): TdfpFilament[] {
  return filaments.filter(
    (f) =>
      squash(spool.brand) === squash(f.brandName) &&
      squash(spool.material) === squash(f.material) &&
      colorsFit(spool, f.color, f.materialType, f.rgb),
  );
}

export type LinkHow = "kept" | "recorded" | "matched" | "chosen";

export type SyncRow =
  /**
   * A linked pair, already ("kept"), by the SpoolEase ID 3DFP keeps for it ("recorded"), by name ("matched") or as
   * asked ("chosen"); patch is what 3DFP gets.
   */
  | {
      kind: "linked";
      how: LinkHow;
      spool: SpoolRecord;
      tdfp: TdfpSpool;
      before: SpoolLink | null;
      after: SpoolLink;
      weight: WeightVerdict;
      patch: SpoolPatch | null;
    }
  /** A new 3DFP spool for a SpoolEase one; grams null leaves it at the filament's own weight. */
  | {
      kind: "add";
      spool: SpoolRecord;
      chosen: boolean;
      filamentId: number;
      filament: TdfpFilament | null;
      grams: number | null;
      tag: string | null;
    }
  | {
      kind: "unlinked";
      link: SpoolLink;
      spool: SpoolRecord | null;
      tdfp: TdfpSpool | null;
      reason: "asked" | "replaced" | "spoolease-gone" | "tdfp-gone";
      /** Clears the 3DFP spool's external_id when it still names this SpoolEase spool, so no sync relinks them. */
      patch: SpoolPatch | null;
    }
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

/** The calls applying these rows takes: their 3DFP updates go up to MAX_BULK_UPDATES a call, each add (tag included) one. */
export function planCalls(rows: SyncRow[]): number {
  const updates = rows.filter(
    (row) => (row.kind === "linked" || row.kind === "unlinked") && row.patch,
  ).length;
  const adds = rows.filter((row) => row.kind === "add").length;
  return Math.ceil(updates / MAX_BULK_UPDATES) + adds;
}

function rowChanges(row: SyncRow): boolean {
  return (
    (row.kind === "linked" && (row.before === null || row.patch !== null)) ||
    row.kind === "add" ||
    row.kind === "unlinked"
  );
}

const byId = (a: SpoolRecord, b: SpoolRecord) =>
  Number(a.id) - Number(b.id) || a.id.localeCompare(b.id);

function linkedRow(
  spool: SpoolRecord,
  tdfp: TdfpSpool,
  before: SpoolLink | null,
  how: LinkHow,
  now: Date,
): SyncRow {
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
  // Unread (undefined) or another app's ID stays as it is.
  const id = externalIdFor(spool.id);
  if (tdfp.externalId !== undefined && externalIdIsOurs(tdfp.externalId) && tdfp.externalId !== id)
    patch.externalId = id;
  const after: SpoolLink = {
    spoolease: spool.id,
    tdfp: tdfp.shortCode,
    agreed,
    tag,
    linkedAt: before?.linkedAt ?? now.toISOString(),
  };
  return {
    kind: "linked",
    how,
    spool,
    tdfp,
    before,
    after,
    weight,
    patch: Object.keys(patch).length ? patch : null,
  };
}

function addRow(
  spool: SpoolRecord,
  filamentId: number,
  filament: TdfpFilament | null,
  chosen: boolean,
): SyncRow {
  const left = remainingGrams(spool);
  return {
    kind: "add",
    spool,
    chosen,
    filamentId,
    filament,
    grams: left === null ? null : Math.min(MAX_GRAMS, left),
    tag: spool.tagId || null,
  };
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
    if (chosenCodes.has(code))
      throw new SyncPlanError(
        `3DFilamentProfiles spool ${code} can't be linked to two SpoolEase spools`,
      );
    chosenCodes.add(code);
  }
  for (const id of chosenAdds.keys()) {
    if (!seById.has(id)) throw new SyncPlanError(`SpoolEase has no spool #${id}`);
    if (chosenLinks.has(id)) throw new SyncPlanError(`#${id} can't be both linked and added`);
    const linked = input.links.find((link) => link.spoolease === id);
    if (linked && !unlinks.has(id))
      throw new SyncPlanError(`#${id} is already linked to ${linked.tdfp}: --unlink ${id} first`);
  }
  for (const id of unlinks)
    if (!input.links.some((link) => link.spoolease === id))
      throw new SyncPlanError(`#${id} isn't linked`);

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
    dropped.push({
      kind: "unlinked",
      link,
      spool: null,
      tdfp: tdByCode.get(link.tdfp) ?? null,
      reason: reason ?? "spoolease-gone",
      patch: null,
    });
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
    if (spool)
      bySpool.set(id, addRow(spool, filamentId, input.filamentById?.(filamentId) ?? null, true));
  }

  // A 3DFP spool that names a SpoolEase spool in its external_id is that spool's, when brand and material agree
  // too (another console's spool #1 is someone else's).
  for (const spool of input.spoolease) {
    if (bySpool.has(spool.id) || settled.has(spool.id)) continue;
    const named = input.tdfp.filter(
      (tdfp) =>
        !takenCodes.has(tdfp.shortCode) &&
        tdfp.externalId === externalIdFor(spool.id) &&
        squash(tdfp.brand) === squash(spool.brand) &&
        squash(tdfp.material) === squash(spool.material),
    );
    const only = named[0];
    if (named.length !== 1 || !only) continue;
    bySpool.set(spool.id, linkedRow(spool, only, null, "recorded", input.now));
    takenCodes.add(only.shortCode);
  }

  const open = input.spoolease.filter((spool) => !bySpool.has(spool.id) && !settled.has(spool.id));
  const freeTdfp = input.tdfp.filter((spool) => !takenCodes.has(spool.shortCode));
  const fits = new Map(
    open.map((spool) => [spool.id, freeTdfp.filter((tdfp) => spoolsMatch(spool, tdfp))]),
  );
  const wanted = new Map<string, number>();
  for (const candidates of fits.values())
    for (const tdfp of candidates)
      wanted.set(tdfp.shortCode, (wanted.get(tdfp.shortCode) ?? 0) + 1);
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
      bySpool.set(
        spool.id,
        filaments.length === 1 && one
          ? addRow(spool, one.id, one, false)
          : { kind: "suggest", spool, filaments },
      );
    }
  }

  const spoolRows = [...input.spoolease]
    .sort(byId)
    .map((spool) => bySpool.get(spool.id))
    .filter((row): row is SyncRow => row !== undefined);
  const tdfpOnly: SyncRow[] = freeTdfp
    .filter((tdfp) => !claimed.has(tdfp.shortCode))
    .map((tdfp) => ({ kind: "tdfp-only", tdfp }));
  // A link that goes clears the ID it left on 3DFP, unless that spool is linked to the same SpoolEase spool again.
  const relinked = new Set(
    spoolRows.flatMap((row) =>
      row.kind === "linked" ? [`${row.spool.id} ${row.tdfp.shortCode}`] : [],
    ),
  );
  for (const row of dropped)
    if (
      row.kind === "unlinked" &&
      row.tdfp?.externalId === externalIdFor(row.link.spoolease) &&
      !relinked.has(`${row.link.spoolease} ${row.tdfp.shortCode}`)
    )
      row.patch = { externalId: null };
  const rows = [...dropped, ...spoolRows, ...tdfpOnly];
  return {
    rows,
    calls: planCalls(rows),
    changes: rows.filter(rowChanges).length,
    now: input.now,
  };
}

export interface RowOutcome {
  row: SyncRow;
  ok: boolean;
  error: string | null;
  /** add: the new 3DFP spool's short code. */
  created?: string;
}

export interface AppliedSync {
  /** The links to keep, in the plan's order: what was sent, or what was already there for rows whose calls failed. */
  links: SpoolLink[];
  /** One per row that needed API calls, in the plan's order. */
  outcomes: RowOutcome[];
  /** Requests sent: what the quota was charged. */
  calls: number;
}

type LinkedRow = Extract<SyncRow, { kind: "linked" }>;
type UpdateRow = Extract<SyncRow, { kind: "linked" | "unlinked" }> & { patch: SpoolPatch };
type AddRow = Extract<SyncRow, { kind: "add" }>;

/** The 3DFP spool an update goes to. */
const updateCode = (row: UpdateRow): string =>
  row.kind === "linked" ? row.tdfp.shortCode : row.link.tdfp;

/** A linked row whose update didn't go through keeps the link, without what wasn't sent. */
const unsentLink = (row: LinkedRow): SpoolLink => ({
  ...row.after,
  agreed: row.before?.agreed ?? null,
  tag: row.before?.tag ?? null,
});

/**
 * Sends the plan's 3DFP writes: the linked and unlinked spools' updates in bulk, MAX_BULK_UPDATES a call, then each
 * add with its tag and SpoolEase ID. A failed update or add doesn't stop the others; a used-up quota stops all calls.
 */
export async function applySync(
  plan: SyncPlan,
  client: FilamentProfilesClient,
  onRow: (outcome: RowOutcome) => void = () => {},
): Promise<AppliedSync> {
  const results = new Map<SyncRow, { link: SpoolLink | null; outcome: RowOutcome }>();
  let calls = 0;
  let quotaGone: string | null = null;
  const settle = (row: SyncRow, link: SpoolLink | null, outcome: RowOutcome) => {
    results.set(row, { link, outcome });
    onRow(outcome);
  };
  // A request that failed still cost a call, unless the quota stopped it before it was sent.
  const failed = (err: unknown): string => {
    if (err instanceof QuotaError) quotaGone = err.message;
    else calls += 1;
    return errorMessage(err);
  };

  const updates = plan.rows.filter(
    (row): row is UpdateRow =>
      (row.kind === "linked" || row.kind === "unlinked") && row.patch !== null,
  );
  for (let start = 0; start < updates.length; start += MAX_BULK_UPDATES) {
    const batch = updates.slice(start, start + MAX_BULK_UPDATES);
    let answers: BulkSpoolResult[] | null = null;
    let error: string | null = quotaGone;
    if (!error) {
      try {
        answers = await client.updateSpools(
          batch.map((row) => ({ shortCode: updateCode(row), ...row.patch })),
        );
        calls += 1;
      } catch (err) {
        error = failed(err);
      }
    }
    batch.forEach((row, index) => {
      const answer = answers?.[index];
      // A link that goes is gone whether or not its ID was cleared.
      const kept = row.kind === "linked" ? row : null;
      if (answer?.ok) settle(row, kept?.after ?? null, { row, ok: true, error: null });
      else
        settle(row, kept ? unsentLink(kept) : null, {
          row,
          ok: false,
          error: answer && !answer.ok ? answer.error : (error ?? "not sent"),
        });
    });
  }

  for (const row of plan.rows.filter((row): row is AddRow => row.kind === "add")) {
    if (quotaGone) {
      settle(row, null, { row, ok: false, error: quotaGone });
      continue;
    }
    let added: AddedSpool;
    try {
      added = await client.addSpool({
        filamentId: row.filamentId,
        ...(row.grams === null ? {} : { remainingGrams: row.grams }),
        ...(row.tag ? { bambuTagId: row.tag } : {}),
        externalId: externalIdFor(row.spool.id),
      });
    } catch (err) {
      settle(row, null, { row, ok: false, error: failed(err) });
      continue;
    }
    calls += 1;
    if (!added.created) {
      settle(row, null, { row, ok: false, error: "3DFilamentProfiles created no spool" });
      continue;
    }
    const code = added.spool.shortCode;
    const link: SpoolLink = {
      spoolease: row.spool.id,
      tdfp: code,
      agreed: row.grams === null ? null : { spoolease: row.grams, tdfp: row.grams },
      tag: row.tag,
      linkedAt: plan.now.toISOString(),
    };
    settle(row, link, { row, ok: true, error: null, created: code });
  }

  const links: SpoolLink[] = [];
  const outcomes: RowOutcome[] = [];
  for (const row of plan.rows) {
    const result = results.get(row);
    if (result) {
      if (result.link) links.push(result.link);
      outcomes.push(result.outcome);
    } else if (row.kind === "linked") links.push(row.after);
  }
  return { links, outcomes, calls };
}
