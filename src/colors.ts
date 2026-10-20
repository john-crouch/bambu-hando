// ABOUTME: Color normalization utilities for converting names/hex into RGBA.
// ABOUTME: Ensures consistent color payloads across BambuStudio and SpoolEase.

const COLOR_NAME_TO_RGB: Record<string, string> = {
  black: "000000",
  white: "FFFFFF",
  red: "FF0000",
  green: "00FF00",
  blue: "0000FF",
  yellow: "FFFF00",
  orange: "FFA500",
  purple: "800080",
  gray: "808080",
  grey: "808080",
  brown: "8B4513",
  pink: "FFC0CB",
  cyan: "00FFFF",
  magenta: "FF00FF",
  transparent: "FFFFFF",
};

const HEX_RE = /^[0-9A-Fa-f]+$/;

/**
 * Return 8-char upper RGBA hex, defaulting alpha to FF.
 *
 * Accepts #RRGGBB, #RRGGBBAA, RRGGBB, RRGGBBAA, then falls back to a known color name, then gray.
 */
export function normalizeRgba(colorName: string, colorValue?: string | null): string {
  if (colorValue) {
    const raw = colorValue.trim().replace(/^#+/, "");
    if ((raw.length === 6 || raw.length === 8) && HEX_RE.test(raw)) {
      return raw.length === 6 ? `${raw.toUpperCase()}FF` : raw.toUpperCase();
    }
  }

  const named = COLOR_NAME_TO_RGB[colorName.trim().toLowerCase()];
  if (named) return `${named}FF`;

  return "808080FF";
}

/** Convert 8-char RGBA hex to #RRGGBB for Bambu-style defaults. */
export function rgbaToHashRgb(rgba: string): string {
  const raw = rgba.trim().replace(/^#+/, "").toUpperCase();
  if (raw.length < 6 || !HEX_RE.test(raw.slice(0, 6))) return "#808080";
  return `#${raw.slice(0, 6)}`;
}
