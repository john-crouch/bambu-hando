// ABOUTME: Remembers the last label choices (fields, size, printer, PDF path) so the TUI offers them again.
// ABOUTME: Stored as JSON in bambu-hando's config directory; damaged or unknown values fall back to defaults.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeAtomic } from "./atomicWrite.js";
import {
  DEFAULT_LABEL_FIELDS,
  DEFAULT_LABEL_SIZE,
  LABEL_FIELDS,
  type LabelField,
  parseLabelSize,
} from "./labels.js";
import { configDir } from "./paths.js";

export interface LabelSettings {
  fields: LabelField[];
  /** As typed, e.g. 57x32mm. */
  size: string;
  /** CUPS destination; empty to only write the PDF. */
  printer: string;
  /** PDF path; empty to only print. */
  output: string;
}

export const DEFAULT_LABEL_SETTINGS: LabelSettings = {
  fields: DEFAULT_LABEL_FIELDS,
  size: DEFAULT_LABEL_SIZE,
  printer: "",
  output: "",
};

export function labelSettingsPath(): string {
  return join(configDir(), "labels.json");
}

function validSize(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    parseLabelSize(value);
    return true;
  } catch {
    return false;
  }
}

export async function loadLabelSettings(path = labelSettingsPath()): Promise<LabelSettings> {
  let saved: Record<string, unknown>;
  try {
    saved = JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return DEFAULT_LABEL_SETTINGS;
  }
  const keys: string[] = LABEL_FIELDS.map((f) => f.key);
  const fields = Array.isArray(saved.fields)
    ? (saved.fields.filter((f) => keys.includes(f)) as LabelField[])
    : [];
  return {
    fields: fields.length > 0 ? fields : DEFAULT_LABEL_SETTINGS.fields,
    size: validSize(saved.size) ? saved.size : DEFAULT_LABEL_SETTINGS.size,
    printer: typeof saved.printer === "string" ? saved.printer : "",
    output: typeof saved.output === "string" ? saved.output : "",
  };
}

/** Written atomically (a temp file of its own per save), so overlapping or interrupted saves never leave a broken file. */
export async function saveLabelSettings(
  settings: LabelSettings,
  path = labelSettingsPath(),
): Promise<void> {
  await writeAtomic(path, `${JSON.stringify(settings, null, 2)}\n`);
}
