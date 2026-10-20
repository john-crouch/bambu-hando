"""ABOUTME: Color normalization utilities for converting names/hex into RGBA.
ABOUTME: Ensures consistent color payloads across BambuStudio and SpoolEase."""

from __future__ import annotations

import re

COLOR_NAME_TO_RGB = {
    "black": "000000",
    "white": "FFFFFF",
    "red": "FF0000",
    "green": "00FF00",
    "blue": "0000FF",
    "yellow": "FFFF00",
    "orange": "FFA500",
    "purple": "800080",
    "gray": "808080",
    "grey": "808080",
    "brown": "8B4513",
    "pink": "FFC0CB",
    "cyan": "00FFFF",
    "magenta": "FF00FF",
    "transparent": "FFFFFF",
}

_HEX_RE = re.compile(r"^[0-9A-Fa-f]+$")


def normalize_rgba(color_name: str, color_value: str | None = None) -> str:
    """Return 8-char upper RGBA hex, defaulting alpha to FF.

    Accepted values:
    - #RRGGBB
    - #RRGGBBAA
    - RRGGBB
    - RRGGBBAA
    - known color name fallback
    """

    if color_value:
        raw = color_value.strip().lstrip("#")
        if len(raw) in (6, 8) and _HEX_RE.match(raw):
            if len(raw) == 6:
                return f"{raw.upper()}FF"
            return raw.upper()

    named = COLOR_NAME_TO_RGB.get(color_name.strip().lower())
    if named:
        return f"{named}FF"

    return "808080FF"


def rgba_to_hash_rgb(rgba: str) -> str:
    """Convert 8-char RGBA hex to #RRGGBB for Bambu-style defaults."""

    raw = rgba.strip().lstrip("#").upper()
    if len(raw) < 6 or not _HEX_RE.match(raw[:6]):
        return "#808080"
    return f"#{raw[:6]}"
