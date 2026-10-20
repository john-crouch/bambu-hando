"""ABOUTME: Profile source ingestion from URL/local JSON into normalized records.
ABOUTME: Supports lightweight schema so users can bulk-import filament catalogs."""

from __future__ import annotations

from pathlib import Path
import json
from typing import Any

import requests

from .colors import normalize_rgba
from .models import FilamentProfile


def _read_text(source: str) -> str:
    if source.startswith("http://") or source.startswith("https://"):
        resp = requests.get(source, timeout=20)
        resp.raise_for_status()
        return resp.text
    return Path(source).read_text(encoding="utf-8")


def load_profiles(source: str) -> list[FilamentProfile]:
    """Load profiles from JSON list or object with profiles key.

    Supported item keys:
    - name, brand, material, color_name, color_rgba|color_hex
    - nozzle_temp_min, nozzle_temp_max, density, diameter, slicer_filament_code
    """

    raw = _read_text(source)
    payload = json.loads(raw)

    if isinstance(payload, dict):
        items = payload.get("profiles", [])
    elif isinstance(payload, list):
        items = payload
    else:
        raise ValueError("Unsupported profile source shape: expected JSON list or object")

    result: list[FilamentProfile] = []
    for idx, item in enumerate(items):
        if not isinstance(item, dict):
            raise ValueError(f"Profile entry at index {idx} is not an object")

        name = str(item.get("name", "")).strip()
        brand = str(item.get("brand", "Generic")).strip() or "Generic"
        material = str(item.get("material", "PLA")).strip().upper() or "PLA"
        color_name = str(item.get("color_name", "Unknown")).strip() or "Unknown"
        color_rgba = normalize_rgba(color_name=color_name, color_value=item.get("color_rgba") or item.get("color_hex"))

        if not name:
            raise ValueError(f"Profile entry at index {idx} is missing name")

        result.append(
            FilamentProfile(
                name=name,
                brand=brand,
                material=material,
                color_name=color_name,
                color_rgba=color_rgba,
                nozzle_temp_min=int(item.get("nozzle_temp_min", 190)),
                nozzle_temp_max=int(item.get("nozzle_temp_max", 240)),
                density=float(item.get("density", 1.24)),
                diameter=float(item.get("diameter", 1.75)),
                slicer_filament_code=str(item.get("slicer_filament_code", "")).strip(),
            )
        )

    return result
