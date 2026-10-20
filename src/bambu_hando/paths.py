"""ABOUTME: OS-aware path resolution for BambuStudio and local app data.
ABOUTME: Keeps platform logic isolated and easy to test."""

from __future__ import annotations

from pathlib import Path
import platform


def bambu_user_root(system: str | None = None) -> Path:
    """Return BambuStudio user root for Linux/macOS.

    This follows BambuStudio source-path conventions for public builds.
    """

    sys_name = (system or platform.system()).lower()
    home = Path.home()
    if "linux" in sys_name:
        return home / ".config" / "BambuStudio" / "user"
    if "darwin" in sys_name or "mac" in sys_name:
        return home / "Library" / "Application Support" / "BambuStudio" / "user"
    raise RuntimeError(f"Unsupported OS for this tool: {system or platform.system()}")


def bambu_filament_dir(preset_folder: str = "default", system: str | None = None) -> Path:
    return bambu_user_root(system=system) / preset_folder / "filament"
