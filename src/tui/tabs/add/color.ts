// ABOUTME: The "Other color…" dialog: a color SpoolmanDB doesn't list, with the settings of a listed one of the same material.
// ABOUTME: Pure model and key handling; the variant joins the session's catalog, ticked.

import type { FilamentProfile } from "../../../models.js";
import { derivedFilamentId } from "../../../sources.js";
import { type KeyPress, letter } from "../../core/keys.js";
import { moveCursor, typeAhead } from "../../ui/list.js";
import { editText, type TextState } from "../../ui/textField.js";

export const COLOR_FIELDS = ["base", "name", "hex", "add"] as const;
export type ColorField = (typeof COLOR_FIELDS)[number];

const HEX = /^#?([0-9a-f]{6})$/i;

export interface ColorDialog {
  brand: string;
  material: string;
  /** The listed colors of this brand and material, sorted by name. */
  bases: FilamentProfile[];
  /** Index into bases of the color whose settings the new one takes; null only when the list has none. */
  base: number | null;
  name: TextState;
  /** As typed: 6 hex digits, with or without "#". */
  hex: TextState;
  field: ColorField;
  error: string;
}

export type ColorDialogResult =
  | { dialog: ColorDialog }
  | { close: true }
  | { added: FilamentProfile };

/** Opens on `preferred` (a ticked color of the list) as the one it's like, else the first listed color. */
export function openColorDialog(
  brand: string,
  material: string,
  bases: FilamentProfile[],
  preferred?: FilamentProfile,
): ColorDialog {
  const sorted = [...bases].sort((a, b) =>
    a.colorName.localeCompare(b.colorName, undefined, { sensitivity: "base" }),
  );
  const at = preferred ? sorted.indexOf(preferred) : -1;
  return {
    brand,
    material,
    bases: sorted,
    base: sorted.length === 0 ? null : Math.max(0, at),
    name: { value: "", cursor: 0 },
    hex: { value: "", cursor: 0 },
    field: "base",
    error: "",
  };
}

/**
 * `base` with another color: same brand, material, temperatures, density and weights; a name ending in
 * the new color (as SpoolmanDB names end in theirs) and the ID derived from it. A slicer filament code
 * isn't carried over, since it identifies the listed color.
 */
export function colorVariant(
  base: FilamentProfile,
  colorName: string,
  colorRgba: string,
): FilamentProfile {
  const prefix =
    base.colorName && base.name.endsWith(base.colorName)
      ? base.name.slice(0, -base.colorName.length)
      : `${base.brand} ${base.material} `;
  const name = `${prefix}${colorName}`;
  return {
    ...base,
    name,
    colorName,
    colorRgba,
    slicerFilamentCode: "",
    filamentId: derivedFilamentId(name),
  };
}

/** The "#RRGGBB" typed so far, when it is one; for the live swatch. */
export function typedColor(hex: string): string | null {
  const digits = HEX.exec(hex.trim())?.[1];
  return digits ? `#${digits.toUpperCase()}` : null;
}

/** Whether keys go into a text field: the name and the hex. */
export function dialogTyping(dialog: ColorDialog): boolean {
  return dialog.field === "name" || dialog.field === "hex";
}

/** The variant the dialog describes, or what's missing; `listed` is every catalog profile, to refuse a name it has. */
export function colorDialogProfile(
  dialog: ColorDialog,
  listed: FilamentProfile[],
): { profile: FilamentProfile } | { error: string } {
  const base = dialog.base === null ? undefined : dialog.bases[dialog.base];
  if (!base) return { error: "Choose the listed color it's like" };
  const colorName = dialog.name.value.trim();
  if (!colorName) return { error: "Type the color's name" };
  const color = typedColor(dialog.hex.value);
  if (!color) return { error: "Type the color as 6 hex digits, such as AD0000" };
  const profile = colorVariant(base, colorName, `${color.slice(1)}FF`);
  const taken = listed.find((p) => p.name.toLowerCase() === profile.name.toLowerCase());
  if (taken) return { error: `${profile.name} is already listed` };
  return { profile };
}

function cycleBase(dialog: ColorDialog, step: 1 | -1): number | null {
  const count = dialog.bases.length;
  if (count === 0) return null;
  if (dialog.base === null) return step === 1 ? 0 : count - 1;
  return (dialog.base + step + count) % count;
}

export function colorDialogKey(
  dialog: ColorDialog,
  key: KeyPress,
  listed: FilamentProfile[],
): ColorDialogResult {
  const next = (changes: Partial<ColorDialog>): ColorDialogResult => ({
    dialog: { ...dialog, error: "", ...changes },
  });
  const index = COLOR_FIELDS.indexOf(dialog.field);

  if (key.name === "esc") return { close: true };
  if (key.name === "tab") {
    const step = key.shift ? -1 : 1;
    const field = COLOR_FIELDS[(index + step + COLOR_FIELDS.length) % COLOR_FIELDS.length];
    return next({ field: field ?? dialog.field });
  }
  if (key.name === "up" || key.name === "down") {
    const moved = moveCursor(index, key, COLOR_FIELDS.length, 1) ?? index;
    return next({ field: COLOR_FIELDS[moved] ?? dialog.field });
  }
  if (key.name === "enter") {
    if (dialog.field !== "add") return next({ field: COLOR_FIELDS[index + 1] ?? "add" });
    const made = colorDialogProfile(dialog, listed);
    return "error" in made ? next({ error: made.error }) : { added: made.profile };
  }
  if (dialog.field === "base") {
    if (key.name === "right") return next({ base: cycleBase(dialog, 1) });
    if (key.name === "left") return next({ base: cycleBase(dialog, -1) });
    const typedLetter = letter(key);
    if (typedLetter && dialog.bases.length > 0) {
      const labels = dialog.bases.map((p) => p.colorName);
      const from = dialog.base ?? -1;
      const found = typeAhead(labels, from < 0 ? labels.length - 1 : from, typedLetter);
      if (labels[found]?.toLowerCase().startsWith(typedLetter)) return next({ base: found });
    }
    return { dialog };
  }
  if (dialog.field === "name" || dialog.field === "hex") {
    const edited = editText(dialog[dialog.field], key);
    if (edited) {
      // A paste or burst ending in enter fills the field and moves on, like typing it then enter.
      const text = { value: edited.value, cursor: edited.cursor };
      return next({
        [dialog.field]: text,
        ...(edited.submit ? { field: COLOR_FIELDS[index + 1] ?? "add" } : {}),
      });
    }
  }
  return { dialog };
}
