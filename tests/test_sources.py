"""ABOUTME: Tests profile source ingestion and normalization.
ABOUTME: Ensures imported data maps correctly to internal model fields."""

from pathlib import Path

from bambu_hando.sources import load_profiles


def test_load_profiles_from_json_file(tmp_path: Path) -> None:
    source = tmp_path / "profiles.json"
    source.write_text(
        """
[
  {
    "name": "PETG Red",
    "brand": "Polymaker",
    "material": "PETG",
    "color_name": "Red",
    "color_hex": "#FF2200",
    "nozzle_temp_min": 230,
    "nozzle_temp_max": 255,
    "density": 1.27,
    "diameter": 1.75,
    "slicer_filament_code": "PABC1234"
  }
]
""".strip(),
        encoding="utf-8",
    )

    profiles = load_profiles(str(source))
    assert len(profiles) == 1
    p = profiles[0]
    assert p.name == "PETG Red"
    assert p.brand == "Polymaker"
    assert p.material == "PETG"
    assert p.color_rgba == "FF2200FF"
    assert p.nozzle_temp_min == 230
    assert p.nozzle_temp_max == 255
