"""ABOUTME: Tests OS-specific path resolution for BambuStudio config locations.
ABOUTME: Prevents regressions in Linux/macOS compatibility logic."""

from bambu_hando.paths import bambu_user_root


def test_bambu_user_root_linux() -> None:
    path = bambu_user_root(system="Linux")
    assert "/.config/BambuStudio/user" in str(path)


def test_bambu_user_root_macos() -> None:
    path = bambu_user_root(system="Darwin")
    assert "/Library/Application Support/BambuStudio/user" in str(path)
