// ABOUTME: Spool label content: which fields a label shows, its size, and the SpoolEase spool link in its QR code.
// ABOUTME: Pure functions over SpoolEase spool records; labelPdf.ts draws the result.

import type { CustomFilament, SpoolRecord } from "./spoolease.js";

export const LABEL_FIELDS = [
  {
    key: "qr",
    description:
      "QR code with SpoolEase's link for the spool (ID, brand, material, color, weights)",
  },
  { key: "brand", description: "Brand" },
  { key: "material", description: "Material and subtype, e.g. PETG HF" },
  { key: "name", description: "Filament name from SpoolEase's custom filaments" },
  { key: "color", description: "Color name" },
  { key: "hex", description: "Color code, e.g. #F1C400" },
  { key: "temps", description: "Nozzle temperature range" },
  { key: "weight", description: "Filament weight on the label, e.g. 1000 g" },
  { key: "empty", description: "Empty spool weight" },
  { key: "code", description: "Slicer filament code (the BambuStudio preset's filament_id)" },
  { key: "location", description: "Where the spool is, else where it belongs" },
  { key: "added", description: "Date the spool was added to SpoolEase" },
  { key: "note", description: "SpoolEase note" },
  { key: "id", description: "SpoolEase spool ID" },
] as const;

export type LabelField = (typeof LABEL_FIELDS)[number]["key"];

export const DEFAULT_LABEL_FIELDS: LabelField[] = [
  "qr",
  "brand",
  "material",
  "color",
  "temps",
  "weight",
  "id",
];

/** The common 2.25x1.25 in thermal label, in whole millimeters as thermal label drivers take sizes. */
export const DEFAULT_LABEL_SIZE = "57x32mm";

/** Visual weight of a line; labelPdf.ts maps each to a font and size. */
export type LineStyle = "title" | "strong" | "normal" | "small";

export interface LabelLine {
  field: LabelField;
  text: string;
  style: LineStyle;
}

export interface LabelContent {
  /** What the QR code encodes; null leaves the QR code out. */
  qr: string | null;
  lines: LabelLine[];
}

export interface LabelSize {
  /** PDF points. */
  width: number;
  height: number;
  /** CUPS media name, e.g. Custom.2.5x1.5in. */
  media: string;
}

const POINTS_PER_UNIT = { in: 72, mm: 72 / 25.4 } as const;

/** "2.5x1.5in", "2.5x1.5" (inches) or "40x30mm". */
export function parseLabelSize(text: string): LabelSize {
  const m = /^\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*(in|mm)?\s*$/i.exec(text);
  const width = Number(m?.[1]);
  const height = Number(m?.[2]);
  if (!m || !(width > 0) || !(height > 0))
    throw new Error(`label size must look like 2.5x1.5in or 40x30mm, got "${text}"`);
  const unit = (m[3]?.toLowerCase() ?? "in") as keyof typeof POINTS_PER_UNIT;
  return {
    width: width * POINTS_PER_UNIT[unit],
    height: height * POINTS_PER_UNIT[unit],
    media: `Custom.${m[1]}x${m[2]}${unit}`,
  };
}

/** Comma-separated field keys, returned in label order. */
export function parseLabelFields(text: string): LabelField[] {
  const keys: string[] = LABEL_FIELDS.map((f) => f.key);
  const wanted = text
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (wanted.length === 0) throw new Error("no label fields given");
  for (const key of wanted) {
    if (!keys.includes(key))
      throw new Error(`unknown label field "${key}"; fields: ${keys.join(", ")}`);
  }
  return LABEL_FIELDS.map((f) => f.key).filter((key) => wanted.includes(key));
}

const TAG_URL_PREFIX_S1 = "https://tag.spoolease.io/S1/";

// SpoolEase percent-encodes every byte but ASCII letters, digits and ";" (spool_record.rs ENCODE_SET).
function encodeTagValue(value: string): string {
  return [...Buffer.from(value, "utf-8")]
    .map((b) =>
      /[A-Za-z0-9;]/.test(String.fromCharCode(b))
        ? String.fromCharCode(b)
        : `%${b.toString(16).toUpperCase().padStart(2, "0")}`,
    )
    .join("");
}

/**
 * SpoolEase's S1 link for a spool, in the field order its NFC tags use (to_tag_descriptor_s1). The tag
 * id, slicer name, temperatures and note are left out: a label has no tag, and the rest only makes the
 * QR code denser.
 */
export function spoolTagUrl(spool: SpoolRecord): string {
  const parts: [string, string | number | null][] = [
    ["ID", spool.id],
    ["DA", spool.addedTime],
    ["M", spool.material],
    ["MS", spool.subtype],
    ["CC", spool.colorCodes.join(";")],
    ["CN", spool.colorName],
    ["B", spool.brand],
    ["WL", spool.labelWeight],
    ["WE", spool.coreWeight],
    ["WF", spool.fullWeight],
    ["SC", spool.slicerFilament],
  ];
  // Like SpoolEase's part_val, a value equal to its type's default (0 or "") is left out.
  const query = parts
    .filter(([, value]) => value !== null && value !== "" && value !== 0)
    .map(([key, value]) => `${key}=${encodeTagValue(String(value))}`)
    .join("&");
  return `${TAG_URL_PREFIX_S1}?${query}`;
}

function temps(filament: CustomFilament | undefined): string {
  const { nozzleTempMin: low, nozzleTempMax: high } = filament ?? {};
  if (low == null && high == null) return "";
  if (low == null || high == null || low === high) return `${low ?? high}°C`;
  return `${low}–${high}°C`;
}

function addedDate(seconds: number | null): string {
  return seconds === null ? "" : `Added ${new Date(seconds * 1000).toISOString().slice(0, 10)}`;
}

/** The label for one spool: the chosen fields that have a value, in label order. */
export function labelContent(
  spool: SpoolRecord,
  filaments: Map<string, CustomFilament>,
  fields: LabelField[],
): LabelContent {
  const filament = filaments.get(spool.slicerFilament);
  const values: Record<Exclude<LabelField, "qr">, [string, LineStyle]> = {
    brand: [spool.brand, "title"],
    material: [[spool.material, spool.subtype].filter(Boolean).join(" "), "strong"],
    name: [filament?.name ?? "", "normal"],
    color: [spool.colorName, "normal"],
    hex: [spool.colorCodes.map((c) => `#${c.slice(0, 6)}`).join(" / "), "normal"],
    temps: [temps(filament), "normal"],
    weight: [spool.labelWeight ? `${spool.labelWeight} g` : "", "normal"],
    empty: [spool.coreWeight ? `Empty ${spool.coreWeight} g` : "", "normal"],
    code: [spool.slicerFilament, "small"],
    location: [spool.location, "normal"],
    added: [addedDate(spool.addedTime), "small"],
    note: [spool.note, "small"],
    id: [`Spool #${spool.id}`, "small"],
  };
  const lines: LabelLine[] = [];
  for (const field of fields) {
    if (field === "qr") continue;
    const [text, style] = values[field];
    if (text) lines.push({ field, text, style });
  }
  return { qr: fields.includes("qr") ? spoolTagUrl(spool) : null, lines };
}

/** One line naming a spool, for listings. */
export function describeSpool(spool: SpoolRecord): string {
  return [spool.brand, spool.material, spool.subtype, spool.colorName].filter(Boolean).join(" ");
}

export interface SpoolFilters {
  /** Spool IDs; when given, the result follows their order. */
  ids: string[];
  brand: string;
  material: string;
  /** Words that must all appear in the spool's description or filament name. */
  match: string;
}

export function filterSpools(
  spools: SpoolRecord[],
  filaments: Map<string, CustomFilament>,
  filters: SpoolFilters,
): SpoolRecord[] {
  let chosen = spools;
  if (filters.ids.length > 0) {
    const found: SpoolRecord[] = [];
    const missing: string[] = [];
    for (const id of filters.ids) {
      const spool = spools.find((s) => s.id === id);
      if (spool) found.push(spool);
      else missing.push(id);
    }
    if (missing.length > 0) throw new Error(`SpoolEase has no spool with ID ${missing.join(", ")}`);
    chosen = found;
  }
  const brand = filters.brand.toLowerCase();
  const material = filters.material.toLowerCase();
  const words = filters.match.toLowerCase().split(/\s+/).filter(Boolean);
  return chosen.filter((spool) => {
    if (brand && spool.brand.toLowerCase() !== brand) return false;
    if (material && spool.material.toLowerCase() !== material) return false;
    const haystack =
      `${describeSpool(spool)} ${filaments.get(spool.slicerFilament)?.name ?? ""}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
