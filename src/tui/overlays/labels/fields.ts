// ABOUTME: One display name per label field, shared by the labels dialog and Settings › Labels.
// ABOUTME: labelFieldName for a list row ("Color name"), labelFieldList for a summary ("QR code, brand, spool ID").

import { LABEL_FIELDS, type LabelField } from "../../../labels.js";

/** Sentence case; QR and ID keep their capitals inside a sentence too. */
const NAMES: Record<LabelField, string> = {
  qr: "QR code",
  brand: "Brand",
  material: "Material",
  name: "Filament name",
  color: "Color name",
  hex: "Color code",
  temps: "Temperatures",
  weight: "Weight",
  empty: "Empty weight",
  code: "Filament code",
  location: "Location",
  added: "Date added",
  note: "Note",
  id: "Spool ID",
};

/** The longest name, so a grid of ticks can size its cells. */
export const LABEL_FIELD_NAME_MAX = Math.max(...Object.values(NAMES).map((n) => n.length));

/** A label field as a list shows it, e.g. "Color name". */
export function labelFieldName(field: LabelField): string {
  return NAMES[field];
}

/** The name inside a sentence: lowercase first letter unless it starts an acronym ("QR code"). */
function inSentence(field: LabelField): string {
  const name = NAMES[field];
  return /^[A-Z]{2}/.test(name) ? name : name.charAt(0).toLowerCase() + name.slice(1);
}

/** Fields in print order as one sentence, e.g. "QR code, brand, spool ID". */
export function labelFieldList(fields: readonly LabelField[]): string {
  const names = LABEL_FIELDS.filter((f) => fields.includes(f.key)).map((f) => inSentence(f.key));
  const text = names.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
