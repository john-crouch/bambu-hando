"""ABOUTME: Tests BambuStudio preset writing, including dry-run side effects.
ABOUTME: Guards that planning never touches the user's BambuStudio config tree."""

from pathlib import Path

import pytest

from bambu_hando import bambu_studio
from bambu_hando.models import FilamentProfile


@pytest.fixture
def profile() -> FilamentProfile:
    return FilamentProfile(
        name="PETG Red",
        brand="Polymaker",
        material="PETG",
        color_name="Red",
        color_rgba="FF2200FF",
        nozzle_temp_min=230,
        nozzle_temp_max=255,
    )


@pytest.fixture
def target_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    target = tmp_path / "BambuStudio" / "user" / "default" / "filament"
    monkeypatch.setattr(bambu_studio, "bambu_filament_dir", lambda preset_folder: target)
    return target


def test_dry_run_creates_no_directories(profile: FilamentProfile, target_dir: Path) -> None:
    path = bambu_studio.write_filament_preset(profile, printer_preset="X1C", dry_run=True)

    assert path == target_dir / "PETG Red @ X1C.json"
    assert not target_dir.exists()


def test_write_many_reports_os_errors_per_profile(profile: FilamentProfile, target_dir: Path) -> None:
    target_dir.parent.mkdir(parents=True)
    target_dir.write_text("not a directory", encoding="utf-8")

    outcomes = bambu_studio.write_many([profile], preset_folder="default", printer_preset="X1C")

    assert len(outcomes) == 1
    path, error = outcomes[0]
    assert path == target_dir / "PETG Red @ X1C.json"
    assert "File exists" in error


def test_write_many_reports_no_error_on_success(profile: FilamentProfile, target_dir: Path) -> None:
    outcomes = bambu_studio.write_many([profile], preset_folder="default", printer_preset="X1C")

    assert outcomes == [(target_dir / "PETG Red @ X1C.json", "")]


def test_apply_writes_preset_and_creates_directory(profile: FilamentProfile, target_dir: Path) -> None:
    path = bambu_studio.write_filament_preset(profile, printer_preset="X1C", dry_run=False)

    assert path.is_file()
    assert not path.with_suffix(".json.tmp").exists()
    assert '"name": "PETG Red @ X1C"' in path.read_text(encoding="utf-8")
