"""ABOUTME: Tests color normalization and conversion behavior.
ABOUTME: Guards RGB/RGBA behavior for SpoolEase and BambuStudio payloads."""

from bambu_hando.colors import normalize_rgba, rgba_to_hash_rgb


def test_normalize_rgba_hex6_adds_alpha() -> None:
    assert normalize_rgba("ignored", "#AABBCC") == "AABBCCFF"


def test_normalize_rgba_hex8_keeps_alpha() -> None:
    assert normalize_rgba("ignored", "11223344") == "11223344"


def test_normalize_rgba_named_color() -> None:
    assert normalize_rgba("red", None) == "FF0000FF"


def test_rgba_to_hash_rgb() -> None:
    assert rgba_to_hash_rgb("FFA500FF") == "#FFA500"
