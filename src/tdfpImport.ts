// ABOUTME: Brings spools you already keep on 3DFilamentProfiles into BambuStudio and SpoolEase: presets and the custom
// ABOUTME: filament row through runSync, one SpoolEase spool per 3DFP spool, then a link and its external_id on 3DFP.

import { QuotaError } from "./apiQuota.js";
import { normalizeRgba } from "./colors.js";
import { errorMessage } from "./errors.js";
import {
  type FilamentProfilesClient,
  MAX_BULK_UPDATES,
  type TdfpFilamentDetail,
  type TdfpSpool,
} from "./filamentProfiles.js";
import type { FilamentProfile } from "./models.js";
import { layered, type PresetSettings, settingsFromRecord } from "./presetSettings.js";
import { derivedFilamentId } from "./sources.js";
import { SpoolEaseClient, type SpoolEaseConnection, type SpoolRecord } from "./spoolease.js";
import { externalIdFor, type SpoolLink } from "./spoolLinks.js";
import { runSync, type SyncEvent, type SyncOutcome } from "./sync.js";

/** spool_properties keys that aren't calibration: what every spool has. */
const NOT_CALIBRATION = new Set(["purchase_date", "last_dried_date", "bambu_tag_uid"]);
const DEFAULT_TEMPS = [190, 240] as const;

/**
 * Whether the spool carries calibration of its own: anything set in spool_properties besides its dates and tag
 * (inferred: the API names those keys only as "calibrated temperatures", so any other value counts).
 */
export function hasCalibration(spool: TdfpSpool): boolean {
  return Object.entries(spool.spoolProperties ?? {}).some(
    ([key, value]) =>
      !NOT_CALIBRATION.has(key) && value !== null && value !== undefined && value !== "",
  );
}

/** SpoolEase parses its custom-filaments CSV with a plain split(","), so names carry no commas. */
const words = (...parts: Array<string | null | undefined>): string =>
  parts
    .filter(Boolean)
    .join(" ")
    .replace(/[,\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const squash = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The profile a 3DFP spool's filament becomes: 3DFP's record for its presets, the spool's own calibration first. */
export function importProfile(
  spool: TdfpSpool,
  record: TdfpFilamentDetail,
  calibration: PresetSettings,
): FilamentProfile {
  const material = (record.material || spool.material).toUpperCase();
  const name = words(spool.brand, material, spool.materialType, spool.color);
  const colorName = words(spool.materialType, spool.color);
  const low = record.tempMin ?? record.tempMax;
  const high = record.tempMax ?? record.tempMin;
  const [nozzleTempMin, nozzleTempMax] =
    low !== null && high !== null ? [Math.round(low), Math.round(high)] : DEFAULT_TEMPS;
  const settings = layered(calibration, settingsFromRecord(record));
  return {
    name,
    brand: spool.brand,
    material,
    colorName,
    colorRgba: normalizeRgba(colorName, spool.rgb ?? record.rgb),
    nozzleTempMin,
    nozzleTempMax,
    // 3DFP gives density in mg/cm³ and diameter in µm.
    density: record.density ? Math.round(record.density) / 1000 : 1.24,
    diameter: record.diameter ? Math.round(record.diameter) / 1000 : 1.75,
    slicerFilamentCode: "",
    filamentId: derivedFilamentId(name),
    labelWeight: Math.round(record.nominalWeight ?? 0),
    // The list's empty weight is the spool's own when it has one, else the filament's.
    coreWeight: Math.round(spool.emptySpoolWeight ?? record.spoolWeight ?? 0),
    ...(Object.keys(settings).length ? { settings } : {}),
  };
}

export interface ImportItem {
  spool: TdfpSpool;
  profile: FilamentProfile;
  /** The spool's own calibration was read (one call). */
  calibrated: boolean;
}

export interface ImportRefusal {
  code: string;
  reason: string;
}

export interface PreparedImport {
  items: ImportItem[];
  refused: ImportRefusal[];
}

export interface ImportInput {
  /** 3DFP short codes to bring in. */
  codes: string[];
  tdfp: TdfpSpool[];
  links: SpoolLink[];
  spoolease: SpoolRecord[];
  /** The filament's full 3DFP record (the catalog's, or one call). */
  record: (filamentId: number) => Promise<TdfpFilamentDetail>;
  /** The spool's own calibration (one call); asked only for spools that have some. */
  calibration: (shortCode: string) => Promise<PresetSettings>;
}

/** What each code becomes, or why it isn't brought in. Reads each filament's record once. */
export async function prepareImport(input: ImportInput): Promise<PreparedImport> {
  const byCode = new Map(input.tdfp.map((spool) => [spool.shortCode, spool]));
  const linkedTo = new Map(input.links.map((link) => [link.tdfp, link.spoolease]));
  const claimed = new Set(input.links.map((link) => link.spoolease));
  const records = new Map<number, Promise<TdfpFilamentDetail>>();
  const items: ImportItem[] = [];
  const refused: ImportRefusal[] = [];

  for (const code of [...new Set(input.codes)]) {
    const spool = byCode.get(code);
    if (!spool) {
      refused.push({ code, reason: `3DFilamentProfiles has no spool ${code}` });
      continue;
    }
    const linked = linkedTo.get(code);
    if (linked) {
      refused.push({ code, reason: `already linked to SpoolEase spool #${linked}` });
      continue;
    }
    if (squash(spool.brand) === "bambulab") {
      refused.push({
        code,
        reason:
          "a Bambu Lab filament: BambuStudio has its own presets for it, so add the spool on SpoolEase directly",
      });
      continue;
    }
    let record = records.get(spool.filamentId);
    if (!record) {
      record = input.record(spool.filamentId);
      records.set(spool.filamentId, record);
    }
    const calibrated = hasCalibration(spool);
    const profile = importProfile(
      spool,
      await record,
      calibrated ? await input.calibration(code) : {},
    );
    // A SpoolEase spool of this filament that no link claims is likely this very spool, named apart.
    const twin = input.spoolease.find(
      (se) => se.slicerFilament === profile.filamentId && !claimed.has(se.id),
    );
    if (twin) {
      refused.push({
        code,
        reason: `SpoolEase spool #${twin.id} is already this filament (${profile.filamentId}): link it with \`bambu-hando 3dfp sync --link ${twin.id}=${code}\``,
      });
      continue;
    }
    items.push({ spool, profile, calibrated });
  }
  return { items, refused };
}

export interface ImportOutcome {
  code: string;
  item: ImportItem;
  /** The SpoolEase spool created for it; null on a dry run or a failure. */
  spoolId: string | null;
  error: string | null;
  /** Linked, but something after the spool didn't go through (its external_id on 3DFP). */
  warning: string | null;
}

export interface AppliedImport {
  outcomes: ImportOutcome[];
  /** New links to add to the link book. */
  links: SpoolLink[];
  sync: SyncOutcome;
  /** 3DFP calls applying it took (the external_id updates). */
  calls: number;
}

export interface ImportDeps {
  sync: { presetFolder: string; printers: string[]; dryRun: boolean; overwritePresets?: boolean };
  connection: SpoolEaseConnection;
  tdfp: FilamentProfilesClient;
  now: Date;
  onEvent?: (event: SyncEvent) => void;
}

/**
 * Writes each filament's presets and custom-filament row once (runSync, no spools), then adds one SpoolEase spool
 * per 3DFP spool (several 3DFP spools of a filament are several physical spools), links each pair and writes the
 * SpoolEase IDs into the 3DFP spools' external_id, MAX_BULK_UPDATES to a call.
 */
export async function applyImport(
  prepared: PreparedImport,
  deps: ImportDeps,
): Promise<AppliedImport> {
  const profiles = [
    ...new Map(prepared.items.map((item) => [item.profile.filamentId, item.profile])).values(),
  ];
  const sync = await runSync(
    { ...deps.sync, profiles, spoolease: deps.connection, createSpools: false },
    deps.onEvent,
  );
  const failures = new Map<string, string>();
  for (const result of sync.results) {
    if (result.spooleaseStatus === "failed") failures.set(result.filamentId, result.detail);
    else if (result.bambuStatus === "failed")
      failures.set(result.filamentId, `BambuStudio presets: ${result.detail}`);
  }

  const client = new SpoolEaseClient(deps.connection);
  const outcomes: ImportOutcome[] = [];
  for (const item of prepared.items) {
    const outcome: ImportOutcome = {
      code: item.spool.shortCode,
      item,
      spoolId: null,
      error: failures.get(item.profile.filamentId) ?? null,
      warning: null,
    };
    outcomes.push(outcome);
    if (deps.sync.dryRun || outcome.error) continue;
    try {
      const created = await client.addSpool(item.profile);
      if (created.ok) outcome.spoolId = created.id;
      else outcome.error = `SpoolEase refused the spool: ${created.error}`;
    } catch (err) {
      outcome.error = `adding the SpoolEase spool failed: ${errorMessage(err)}`;
    }
  }

  const made = outcomes.filter((outcome) => outcome.spoolId !== null);
  const links: SpoolLink[] = made.map((outcome) => ({
    spoolease: outcome.spoolId as string,
    tdfp: outcome.code,
    // Not weighed on SpoolEase yet: the next sync asks for a weigh before comparing weights.
    agreed: null,
    tag: null,
    linkedAt: deps.now.toISOString(),
  }));

  let calls = 0;
  for (let start = 0; start < made.length; start += MAX_BULK_UPDATES) {
    const batch = made.slice(start, start + MAX_BULK_UPDATES);
    try {
      const results = await deps.tdfp.updateSpools(
        batch.map((outcome) => ({
          shortCode: outcome.code,
          externalId: externalIdFor(outcome.spoolId as string),
        })),
      );
      calls += 1;
      results.forEach((result, index) => {
        const outcome = batch[index];
        if (outcome && !result.ok)
          outcome.warning = `its SpoolEase ID wasn't written to 3DFP: ${result.error}`;
      });
    } catch (err) {
      // The quota stopping it means nothing was sent.
      if (!(err instanceof QuotaError)) calls += 1;
      for (const outcome of batch)
        outcome.warning = `its SpoolEase ID wasn't written to 3DFP: ${errorMessage(err)}`;
    }
  }
  return { outcomes, links, sync, calls };
}
