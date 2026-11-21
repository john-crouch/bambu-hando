// ABOUTME: What the Settings tab shows and changes: its pages, each page's rows, the lists rows open, and checked text.
// ABOUTME: Pure functions over the session's values and what the tab has read; model.ts turns them into updates.

import type { LabelSettings } from "../../../labelSettings.js";
import { LABEL_FIELDS, type LabelField, parseLabelSize } from "../../../labels.js";
import type { Ctx } from "../../core/types.js";
import type { FormValues } from "../../core/values.js";
import { labelFieldList, labelFieldName } from "../../overlays/labels/fields.js";
import { filterRows, plural, type TextState } from "../../ui/index.js";
import {
  byModelAndNozzle,
  printerLabel,
  printerList,
  shortPrinters,
  validPort,
} from "./connection.js";

export type PageId = "bambu" | "spoolease" | "labels" | "import";

export const PAGES: readonly { id: PageId; title: string }[] = [
  { id: "bambu", title: "BambuStudio" },
  { id: "spoolease", title: "SpoolEase" },
  { id: "labels", title: "Labels" },
  { id: "import", title: "Import" },
];

export type FieldId =
  | "presetFolder"
  | "printerPreset"
  | "overwritePresets"
  | "host"
  | "port"
  | "securityKey"
  | "https"
  | "skipSpoolease"
  | "createSpools"
  | "labelFields"
  | "labelSize"
  | "labelPrinter"
  | "labelOutput"
  | "source"
  | "diameter";

/** toggle flips; choice and multi open a list (one value, or ticks); text and secret open a text field. */
export type FieldKind = "toggle" | "choice" | "multi" | "text" | "secret";

type ToggleField = "overwritePresets" | "https" | "skipSpoolease" | "createSpools";

interface FieldDef {
  id: FieldId;
  label: string;
  kind: FieldKind;
  /** Only matters with SpoolEase on: dim while it's skipped. */
  spoolease?: boolean;
  /** Saved for next time (tui.json, labels.json); the rest last this session only. */
  kept?: boolean;
  /** What the setting does, for the detail panel. */
  about: string;
}

export const PAGE_FIELDS: Record<PageId, readonly FieldDef[]> = {
  bambu: [
    {
      id: "presetFolder",
      label: "Preset folder",
      kind: "choice",
      about:
        "BambuStudio's user folder the presets go in: your Bambu account's number when logged in.",
    },
    {
      id: "printerPreset",
      label: "Printers",
      kind: "multi",
      kept: true,
      about: "Each filament gets one preset per printer ticked here. Remembered for next time.",
    },
    {
      id: "overwritePresets",
      label: "Overwrite presets",
      kind: "toggle",
      about:
        "Off keeps presets that are there already, so tuning done in BambuStudio survives a sync.",
    },
  ],
  spoolease: [
    {
      id: "host",
      label: "Host",
      kind: "text",
      spoolease: true,
      about: "The SpoolEase console's address on your network.",
    },
    {
      id: "port",
      label: "Port",
      kind: "text",
      spoolease: true,
      about: "The console's web port: 80 unless you changed it.",
    },
    {
      id: "securityKey",
      label: "Security key",
      kind: "secret",
      spoolease: true,
      about: "The key set on the console. It's never shown.",
    },
    {
      id: "https",
      label: "Use HTTPS",
      kind: "toggle",
      spoolease: true,
      about: "On when the console is behind an HTTPS proxy.",
    },
    {
      id: "skipSpoolease",
      label: "Use SpoolEase",
      kind: "toggle",
      about: "Off writes BambuStudio presets only, and leaves the console alone.",
    },
    {
      id: "createSpools",
      label: "Create spools",
      kind: "toggle",
      spoolease: true,
      about: "On adds a spool record for each filament synced, besides listing the filament.",
    },
  ],
  labels: [
    {
      id: "labelFields",
      label: "Fields",
      kept: true,
      kind: "multi",
      about: "The lines a spool label prints, always in this order.",
    },
    {
      id: "labelSize",
      label: "Size",
      kept: true,
      kind: "choice",
      about: "The label stock's size: the PDF's page size and the media the printer is sent.",
    },
    {
      id: "labelPrinter",
      label: "Printer",
      kept: true,
      kind: "choice",
      about: "The CUPS printer labels go to.",
    },
    {
      id: "labelOutput",
      label: "Save PDF to",
      kept: true,
      kind: "text",
      about: "A PDF of the labels, besides printing them or instead. Empty for none.",
    },
  ],
  import: [
    {
      id: "source",
      label: "File or URL",
      kind: "text",
      about: "A JSON file or URL of filament profiles: Add lists it beside SpoolmanDB.",
    },
    {
      id: "diameter",
      label: "Diameter",
      kind: "choice",
      about: "The filament diameter of the SpoolmanDB filaments Add offers.",
    },
  ],
};

/** Something the tab reads in the background. */
export type Loadable<T> =
  | { state: "loading"; value?: T }
  | { state: "ready"; value: T }
  | { state: "failed"; error: string; value?: T };

/** What the tab has read besides the session's values. */
export interface Sources {
  /** Folders under BambuStudio's user/ directory. */
  folders: Loadable<string[]>;
  /** BambuStudio's instantiable printers. */
  printers: Loadable<string[]>;
  /** CUPS destinations. */
  labelPrinters: Loadable<string[]>;
  labels: Loadable<LabelSettings>;
}

export interface SettingRow {
  field: FieldId;
  label: string;
  kind: FieldKind;
  /** The value as people read it; the security key only as "set" or "not set". */
  value: string;
  /** For toggles. */
  on?: boolean;
  dim: boolean;
  tone?: "warning";
  /** What the setting does, and anything worth knowing about its value. */
  detail: string;
  /** Saved for next time; else it lasts this session only. */
  kept: boolean;
  /** What to show instead where the value doesn't fit whole ("7 fields"). */
  short?: string;
  /** The value is a file path: shown cut in the middle so its file name stays. */
  path?: boolean;
}

const DEFAULT_FOLDER_NOTE = "used when not logged in to BambuStudio";

function rowValue(
  field: FieldId,
  ctx: Ctx,
  sources: Sources,
): Pick<SettingRow, "value" | "tone" | "short"> {
  const values = ctx.values;
  const labels = sources.labels.value;
  switch (field) {
    case "presetFolder":
      return { value: values.presetFolder };
    case "printerPreset": {
      const printers = printerList(values.printerPreset);
      return printers.length
        ? { value: shortPrinters(printers) }
        : { value: "none", tone: "warning" };
    }
    case "host":
      return values.host.trim()
        ? { value: values.host.trim() }
        : { value: "not set", tone: "warning" };
    case "port":
      return validPort(values.port) === null
        ? { value: values.port || "not set", tone: "warning" }
        : { value: values.port.trim() };
    case "securityKey":
      return values.securityKey ? { value: "set" } : { value: "not set", tone: "warning" };
    case "overwritePresets":
    case "https":
    case "skipSpoolease":
    case "createSpools":
      return { value: toggleOn(field, values) ? "on" : "off" };
    case "labelFields":
      return {
        value: labels ? labelFieldList(labels.fields) : "…",
        ...(labels ? { short: plural(labels.fields.length, "field") } : {}),
      };
    case "labelSize":
      return { value: labels ? labels.size : "…" };
    case "labelPrinter":
      return { value: labels ? labels.printer || "Don't print" : "…" };
    case "labelOutput":
      return { value: labels ? labels.output || "No PDF" : "…" };
    case "source":
      return { value: isSpoolmanDb(values.source) ? "none (SpoolmanDB only)" : values.source };
    case "diameter":
      return { value: `${values.diameter} mm` };
  }
}

/** Whether a toggle row reads on: Use SpoolEase is on while SpoolEase isn't skipped. */
export function toggleOn(field: ToggleField, values: FormValues): boolean {
  return field === "skipSpoolease" ? !values.skipSpoolease : values[field];
}

/** A row whose value is a file path (a PDF to save, a JSON file to import), not a URL or a word. */
function isPath(field: FieldId, value: string): boolean {
  return (
    (field === "labelOutput" || field === "source") &&
    /^[~/.]/.test(value) &&
    !/^[a-z]+:\/\//i.test(value)
  );
}

function isSpoolmanDb(source: string): boolean {
  return !source.trim() || source.trim() === "spoolmandb";
}

/** The rows of a page, in order. */
export function pageRows(page: PageId, ctx: Ctx, sources: Sources): SettingRow[] {
  return PAGE_FIELDS[page].map((def) => {
    const { value, tone, short } = rowValue(def.id, ctx, sources);
    const extra =
      def.id === "presetFolder" && ctx.values.presetFolder === "default"
        ? ` "default" is the one ${DEFAULT_FOLDER_NOTE}.`
        : "";
    return {
      field: def.id,
      label: def.label,
      kind: def.kind,
      value,
      ...(def.kind === "toggle" ? { on: toggleOn(def.id as ToggleField, ctx.values) } : {}),
      dim: Boolean(def.spoolease && ctx.values.skipSpoolease),
      ...(tone ? { tone } : {}),
      ...(short ? { short } : {}),
      detail: def.about + extra,
      kept: Boolean(def.kept),
      ...(isPath(def.id, value) ? { path: true } : {}),
    };
  });
}

export function fieldKind(field: FieldId): FieldKind {
  for (const fields of Object.values(PAGE_FIELDS)) {
    const def = fields.find((f) => f.id === field);
    if (def) return def.kind;
  }
  throw new Error(`unknown setting ${field}`);
}

/** What an empty text field suggests. */
export const PLACEHOLDERS: Partial<Record<FieldId, string>> = {
  host: "e.g. 192.168.1.50 or spoolease.local",
  port: "80",
  securityKey: "the key set on the console",
  source: "a .json file or an https:// URL",
  labelOutput: "e.g. ~/labels.pdf; empty for none",
  labelSize: "e.g. 40x30mm or 2x1in",
  diameter: "e.g. 1.75",
};

/** The value a list item has that opens a text field for a value the list doesn't have. */
export const OTHER = "\u0000other";

export interface ChoiceItem {
  value: string;
  label: string;
  detail?: string;
}

export interface ListSpec {
  multi: boolean;
  items: ChoiceItem[];
  /** Ticked values: the current one for a one-choice list. */
  ticked: string[];
  /** Why the list may be short (a read that failed, nothing found). */
  note?: string;
  /** Still reading what the list offers. */
  loading?: boolean;
}

const LABEL_SIZES: ChoiceItem[] = [
  { value: "57x32mm", label: "57x32mm", detail: "2.25x1.25in thermal roll" },
  { value: "50x30mm", label: "50x30mm" },
  { value: "50x25mm", label: "50x25mm" },
  { value: "40x30mm", label: "40x30mm" },
  { value: "62x29mm", label: "62x29mm", detail: "Brother DK-11209" },
  { value: "2x1in", label: "2x1in", detail: "51x25mm" },
];

export const DIAMETERS = [1.75, 2.85];

function failure<T>(loadable: Loadable<T>): string | undefined {
  return loadable.state === "failed" ? loadable.error : undefined;
}

/** The list a choice or multi row opens. */
export function listFor(field: FieldId, ctx: Ctx, sources: Sources): ListSpec {
  const values = ctx.values;
  const labels = sources.labels.value;
  const withNote = (spec: ListSpec, note: string | undefined, loadable: Loadable<unknown>) => ({
    ...spec,
    ...(note ? { note } : {}),
    ...(loadable.state === "loading" ? { loading: true } : {}),
  });
  switch (field) {
    case "presetFolder": {
      const current = values.presetFolder.trim();
      const names = [
        ...new Set([...(sources.folders.value ?? []), ...(current ? [current] : [])]),
      ].sort();
      return withNote(
        {
          multi: false,
          items: names.map((name) => ({
            value: name,
            label: name,
            ...(name === "default" ? { detail: DEFAULT_FOLDER_NOTE } : {}),
          })),
          ticked: [current],
        },
        failure(sources.folders),
        sources.folders,
      );
    }
    case "printerPreset": {
      const known = sources.printers.value ?? [];
      const current = printerList(values.printerPreset);
      const unknown = current.filter((p) => !known.includes(p));
      return withNote(
        {
          multi: true,
          items: [
            ...[...known].sort(byModelAndNozzle).map((name) => ({
              value: name,
              label: printerLabel(name),
            })),
            ...unknown.map((name) => ({
              value: name,
              label: name,
              detail: "not in BambuStudio's printers",
            })),
          ],
          ticked: current,
        },
        failure(sources.printers),
        sources.printers,
      );
    }
    case "labelFields":
      return {
        multi: true,
        items: LABEL_FIELDS.map((f) => ({
          value: f.key,
          label: labelFieldName(f.key),
          detail: f.description,
        })),
        ticked: labels?.fields ?? [],
      };
    case "labelSize": {
      const current = labels?.size ?? "";
      const listed = LABEL_SIZES.some((item) => item.value === current);
      return {
        multi: false,
        items: [
          ...LABEL_SIZES,
          ...(listed || !current ? [] : [{ value: current, label: current, detail: "your size" }]),
          { value: OTHER, label: "Other size…" },
        ],
        ticked: [current],
      };
    }
    case "labelPrinter": {
      const found = sources.labelPrinters.value ?? [];
      const saved = labels?.printer ?? "";
      const note =
        sources.labelPrinters.state === "ready" && found.length === 0
          ? "No printers found (lpstat -e): labels can still be saved as a PDF"
          : undefined;
      return withNote(
        {
          multi: false,
          items: [
            { value: "", label: "Don't print" },
            ...found.map((name) => ({ value: name, label: name })),
            ...(saved && !found.includes(saved)
              ? [{ value: saved, label: saved, detail: "not in CUPS's printers" }]
              : []),
          ],
          ticked: [saved],
        },
        note,
        sources.labelPrinters,
      );
    }
    case "diameter": {
      const current = values.diameter;
      return {
        multi: false,
        items: [
          ...DIAMETERS.map((d) => ({ value: String(d), label: `${d} mm` })),
          ...(DIAMETERS.includes(current)
            ? []
            : [{ value: String(current), label: `${current} mm`, detail: "your diameter" }]),
          { value: OTHER, label: "Other…" },
        ],
        ticked: [String(current)],
      };
    }
    default:
      throw new Error(`${field} has no list`);
  }
}

/** What an open list remembers beside its cursor: the ticks it opened with, and its filter. */
export interface ListView {
  /** Values ticked when the list opened: shown first, and kept in place while ticks change. */
  pinned?: readonly string[];
  /** The / filter's text; typing goes to it while filtering is true. */
  filter?: TextState;
  filtering?: boolean;
}

/** The items as an open list shows them: the ones ticked when it opened first, then those the filter keeps. */
export function shownItems(
  list: ListSpec,
  open: ListView | { kind: string } | null | undefined,
): ChoiceItem[] {
  // A text field open in the list's place has no view of the list.
  const view: ListView =
    open && !("kind" in open && open.kind !== "list") ? (open as ListView) : {};
  const pinned = list.multi ? (view.pinned ?? []) : [];
  const ordered = pinned.length
    ? [
        ...list.items.filter((item) => pinned.includes(item.value)),
        ...list.items.filter((item) => !pinned.includes(item.value)),
      ]
    : list.items;
  const filter = view.filter?.value.trim() ?? "";
  if (!filter) return ordered;
  return filterRows(
    ordered.map((item) => item.label),
    filter,
  ).flatMap(({ index }) => {
    const item = ordered[index];
    return item ? [item] : [];
  });
}

/**
 * Deep links (app/switchTab focus) to a page's row, as other tabs send them; a page's id alone
 * ("bambu", "spoolease", "labels", "import") opens the page where its cursor was.
 */
export const FOCUS_ROWS: Record<string, FieldId> = {
  "bambu.folder": "presetFolder",
  "bambu.printers": "printerPreset",
  "bambu.overwrite": "overwritePresets",
  "spoolease.host": "host",
  "spoolease.port": "port",
  "spoolease.key": "securityKey",
  "spoolease.https": "https",
  "spoolease.skip": "skipSpoolease",
  "spoolease.spools": "createSpools",
  "labels.fields": "labelFields",
  "labels.size": "labelSize",
  "labels.printer": "labelPrinter",
  "labels.output": "labelOutput",
  "import.source": "source",
  "import.diameter": "diameter",
};

/** The page and row a focus names, or null for one this tab doesn't know. */
export function focusTarget(focus: string): { page: PageId; row?: number } | null {
  const page = PAGES.find((p) => p.id === focus);
  if (page) return { page: page.id };
  const field = FOCUS_ROWS[focus];
  if (!field) return null;
  for (const [id, fields] of Object.entries(PAGE_FIELDS) as [PageId, readonly FieldDef[]][]) {
    const row = fields.findIndex((f) => f.id === field);
    if (row >= 0) return { page: id, row };
  }
  return null;
}

/** A change to apply: to the session's values, or to the label settings. */
export type Change = { values: Partial<FormValues> } | { labels: Partial<LabelSettings> };

/** What a text field starts with. */
export function textFor(field: FieldId, ctx: Ctx, sources: Sources): string {
  const values = ctx.values;
  switch (field) {
    case "host":
      return values.host;
    case "port":
      return values.port;
    case "securityKey":
      return values.securityKey;
    case "source":
      return isSpoolmanDb(values.source) ? "" : values.source;
    case "labelOutput":
      return sources.labels.value?.output ?? "";
    case "labelSize":
      return sources.labels.value?.size ?? "";
    case "diameter":
      return String(values.diameter);
    default:
      throw new Error(`${field} isn't typed`);
  }
}

export const PORT_ERROR = "The port is a whole number from 1 to 65535";

/** The change a typed value makes, or why it can't. */
export function commitText(field: FieldId, text: string): { change: Change } | { error: string } {
  switch (field) {
    case "host":
      return { change: { values: { host: text.trim() } } };
    case "port":
      return validPort(text) === null
        ? { error: PORT_ERROR }
        : { change: { values: { port: text.trim() } } };
    case "securityKey":
      return { change: { values: { securityKey: text } } };
    case "source":
      return { change: { values: { source: isSpoolmanDb(text) ? "spoolmandb" : text.trim() } } };
    case "labelOutput":
      return { change: { labels: { output: text.trim() } } };
    case "labelSize":
      try {
        parseLabelSize(text);
      } catch (err) {
        return { error: (err as Error).message };
      }
      return { change: { labels: { size: text.trim() } } };
    case "diameter": {
      const mm = Number(text.trim());
      return text.trim() && Number.isFinite(mm) && mm > 0
        ? { change: { values: { diameter: mm } } }
        : { error: "The diameter is a number of millimeters above 0" };
    }
    default:
      throw new Error(`${field} isn't typed`);
  }
}

/** The change choosing an item of a one-choice list makes. */
export function chooseItem(field: FieldId, value: string): Change {
  switch (field) {
    case "presetFolder":
      return { values: { presetFolder: value } };
    case "labelSize":
      return { labels: { size: value } };
    case "labelPrinter":
      return { labels: { printer: value } };
    case "diameter":
      return { values: { diameter: Number(value) } };
    default:
      throw new Error(`${field} isn't a one-choice list`);
  }
}

/** The change ticking or unticking an item of a multi list makes, or why it can't. */
export function tickItem(
  field: FieldId,
  value: string,
  list: ListSpec,
): { change: Change } | { error: string } {
  const ticked = new Set(list.ticked);
  if (!ticked.delete(value)) ticked.add(value);
  const inOrder = list.items.map((item) => item.value).filter((v) => ticked.has(v));
  if (field === "printerPreset")
    return inOrder.length
      ? { change: { values: { printerPreset: inOrder.join(", ") } } }
      : { error: "Keep at least one printer ticked" };
  if (field === "labelFields")
    return inOrder.length
      ? { change: { labels: { fields: inOrder as LabelField[] } } }
      : { error: "Keep at least one field ticked" };
  throw new Error(`${field} isn't a multi list`);
}

/** Settings whose change makes an earlier connection test say nothing about the console now. */
export const CONNECTION_FIELDS: readonly (keyof FormValues)[] = [
  "host",
  "port",
  "securityKey",
  "https",
];
