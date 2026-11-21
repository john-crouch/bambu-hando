// ABOUTME: Local SQLite copy of the 3DFilamentProfiles filament database, filled a call at a time and kept between runs.
// ABOUTME: Holds summaries, full records with the time they were fetched, merged-id aliases and how far each fill search got.

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { TdfpFilament, TdfpFilamentDetail } from "./filamentProfiles.js";
import { dataDir } from "./paths.js";

/** A full record this many days old or more is offered for refresh (never refreshed unasked). */
export const STALE_AFTER_DAYS = 30;
const DAY_MS = 86_400_000;

export function catalogPath(): string {
  return join(dataDir(), "3dfp-catalog.sqlite");
}

export interface CatalogEntry {
  filament: TdfpFilament;
  summaryAt: Date;
  record: TdfpFilamentDetail | null;
  recordAt: Date | null;
}

/**
 * How far one fill search got. The key names the search: "all", or comma-joined filters such as
 * "brand:sunlu", "material:pla" or "brand:esun,material:pla". nextPage is the next /filaments page to read.
 */
export interface FillProgress {
  key: string;
  nextPage: number;
  complete: boolean;
  /** More filaments match than the API's 20 pages of 50 can list. */
  truncated: boolean;
  updatedAt: Date;
}

export interface CatalogSearch {
  words?: string;
  brand?: string;
  material?: string;
}

/** Whole days since the full record was fetched; null when there is none. */
export function recordAgeDays(entry: CatalogEntry, now: Date): number | null {
  return entry.recordAt ? Math.floor((now.getTime() - entry.recordAt.getTime()) / DAY_MS) : null;
}

/** True when there's no full record, or it's STALE_AFTER_DAYS old or more. */
export function recordIsStale(entry: CatalogEntry, now: Date): boolean {
  const age = recordAgeDays(entry, now);
  return age === null || age >= STALE_AFTER_DAYS;
}

const SCHEMA = `
create table if not exists filaments (
  id integer primary key,
  brand_key text not null,
  material_key text not null,
  name text not null,
  summary text not null,
  summary_at text not null,
  record text,
  record_at text
);
create index if not exists filaments_brand on filaments (brand_key);
create table if not exists aliases (old_id integer primary key, id integer not null);
create table if not exists fills (
  key text primary key,
  next_page integer not null,
  complete integer not null,
  truncated integer not null,
  updated_at text not null
);
`;

type Row = Record<string, unknown>;

const searchName = (f: TdfpFilament): string =>
  [f.brandName, f.material, f.materialType, f.color].filter(Boolean).join(" ").toLowerCase();
const escapeLike = (word: string): string => word.replace(/[\\%_]/g, (c) => `\\${c}`);

function summaryOf(filament: TdfpFilament): TdfpFilament {
  const {
    id,
    brandKey,
    brandName,
    materialKey,
    material,
    materialTypeKey,
    materialType,
    color,
    rgb,
    tdValue,
    discontinued,
    url,
  } = filament;
  return {
    id,
    brandKey,
    brandName,
    materialKey,
    material,
    materialTypeKey,
    materialType,
    color,
    rgb,
    tdValue,
    discontinued,
    url,
  };
}

export class FilamentCatalog {
  private constructor(private readonly db: DatabaseSync) {}

  static open(path: string = catalogPath()): FilamentCatalog {
    mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec(SCHEMA);
    return new FilamentCatalog(db);
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }

  private upsertSummary(filament: TdfpFilament, at: Date): void {
    const summary = summaryOf(filament);
    this.db
      .prepare(
        `insert into filaments (id, brand_key, material_key, name, summary, summary_at) values (?, ?, ?, ?, ?, ?)
         on conflict (id) do update set brand_key = excluded.brand_key, material_key = excluded.material_key,
           name = excluded.name, summary = excluded.summary, summary_at = excluded.summary_at`,
      )
      .run(
        summary.id,
        summary.brandKey,
        summary.materialKey,
        searchName(summary),
        JSON.stringify(summary),
        at.toISOString(),
      );
  }

  saveSummaries(filaments: TdfpFilament[], at: Date): void {
    this.db.exec("begin");
    try {
      for (const filament of filaments) this.upsertSummary(filament, at);
      this.db.exec("commit");
    } catch (err) {
      this.db.exec("rollback");
      throw err;
    }
  }

  /** A full record fetched for `requestedId`; a different id in it means the filament was merged into that one. */
  saveRecord(requestedId: number, record: TdfpFilamentDetail, at: Date): void {
    this.db.exec("begin");
    try {
      this.upsertSummary(record, at);
      this.db
        .prepare("update filaments set record = ?, record_at = ? where id = ?")
        .run(JSON.stringify(record), at.toISOString(), record.id);
      if (requestedId !== record.id) {
        this.db.prepare("delete from filaments where id = ?").run(requestedId);
        this.db
          .prepare(
            "insert into aliases (old_id, id) values (?, ?) on conflict (old_id) do update set id = excluded.id",
          )
          .run(requestedId, record.id);
      }
      this.db.exec("commit");
    } catch (err) {
      this.db.exec("rollback");
      throw err;
    }
  }

  get(id: number): CatalogEntry | null {
    const alias = this.db.prepare("select id from aliases where old_id = ?").get(id) as
      | Row
      | undefined;
    const row = this.db
      .prepare("select * from filaments where id = ?")
      .get(alias ? Number(alias.id) : id) as Row | undefined;
    if (!row) return null;
    return {
      filament: JSON.parse(String(row.summary)) as TdfpFilament,
      summaryAt: new Date(String(row.summary_at)),
      record: row.record ? (JSON.parse(String(row.record)) as TdfpFilamentDetail) : null,
      recordAt: row.record_at ? new Date(String(row.record_at)) : null,
    };
  }

  /** Every word must appear in "brand material type color"; brand and material are exact keys. */
  search(filters: CatalogSearch, limit = 50): TdfpFilament[] {
    const clauses: string[] = [];
    const params: string[] = [];
    for (const word of (filters.words ?? "").toLowerCase().split(/\s+/).filter(Boolean)) {
      clauses.push("name like ? escape '\\'");
      params.push(`%${escapeLike(word)}%`);
    }
    if (filters.brand) {
      clauses.push("brand_key = ?");
      params.push(filters.brand);
    }
    if (filters.material) {
      clauses.push("material_key = ?");
      params.push(filters.material);
    }
    const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
    const rows = this.db
      .prepare(
        `select summary from filaments ${where} order by name, id limit ${Math.max(0, Math.floor(limit))}`,
      )
      .all(...params) as Row[];
    return rows.map((row) => JSON.parse(String(row.summary)) as TdfpFilament);
  }

  brandKeys(): string[] {
    return (
      this.db.prepare("select distinct brand_key from filaments order by brand_key").all() as Row[]
    ).map((row) => String(row.brand_key));
  }

  materialKeys(brandKey?: string): string[] {
    const rows = (
      brandKey === undefined
        ? this.db.prepare("select distinct material_key from filaments order by material_key").all()
        : this.db
            .prepare(
              "select distinct material_key from filaments where brand_key = ? order by material_key",
            )
            .all(brandKey)
    ) as Row[];
    return rows.map((row) => String(row.material_key));
  }

  fill(key: string): FillProgress | null {
    const row = this.db.prepare("select * from fills where key = ?").get(key) as Row | undefined;
    return row ? fillProgress(row) : null;
  }

  fills(): FillProgress[] {
    return (this.db.prepare("select * from fills order by key").all() as Row[]).map(fillProgress);
  }

  saveFill(progress: FillProgress): void {
    this.db
      .prepare(
        `insert into fills (key, next_page, complete, truncated, updated_at) values (?, ?, ?, ?, ?)
         on conflict (key) do update set next_page = excluded.next_page, complete = excluded.complete,
           truncated = excluded.truncated, updated_at = excluded.updated_at`,
      )
      .run(
        progress.key,
        progress.nextPage,
        progress.complete ? 1 : 0,
        progress.truncated ? 1 : 0,
        progress.updatedAt.toISOString(),
      );
  }

  stats(): { filaments: number; records: number; brands: number; completeBrands: number } {
    const count = (sql: string) => Number((this.db.prepare(sql).get() as Row).n);
    return {
      filaments: count("select count(*) as n from filaments"),
      records: count("select count(*) as n from filaments where record is not null"),
      brands: count("select count(distinct brand_key) as n from filaments"),
      completeBrands: count(
        "select count(*) as n from fills where complete = 1 and key like 'brand:%' and key not like '%,%'",
      ),
    };
  }
}

function fillProgress(row: Row): FillProgress {
  return {
    key: String(row.key),
    nextPage: Number(row.next_page),
    complete: Number(row.complete) === 1,
    truncated: Number(row.truncated) === 1,
    updatedAt: new Date(String(row.updated_at)),
  };
}
