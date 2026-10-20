"""ABOUTME: Shared data models for normalized filament profiles and sync results.
ABOUTME: Keeps parsing and integration logic decoupled from transport details."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

# written: change applied; planned: dry-run only; skipped: integration disabled; failed: attempted and rejected.
Status = Literal["written", "planned", "skipped", "failed"]


@dataclass(frozen=True)
class FilamentProfile:
    """Normalized filament profile used by both BambuStudio and SpoolEase flows."""

    name: str
    brand: str
    material: str
    color_name: str
    color_rgba: str
    nozzle_temp_min: int
    nozzle_temp_max: int
    density: float = 1.24
    diameter: float = 1.75
    slicer_filament_code: str = ""


@dataclass(frozen=True)
class SyncResult:
    """Per-profile operation status with optional details."""

    profile_name: str
    bambu_status: Status
    spoolease_status: Status
    detail: str = ""

    @property
    def failed(self) -> bool:
        return "failed" in (self.bambu_status, self.spoolease_status)
