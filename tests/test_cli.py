"""ABOUTME: Integration tests for the CLI flow, report statuses, and exit codes.
ABOUTME: Runs against a local encrypted HTTP server speaking the SpoolEase protocol."""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import threading
from typing import Iterator

import pytest

from bambu_hando import bambu_studio, cli
from bambu_hando.encryption import decrypt_text, derive_key, encrypt_text

SECURITY_KEY = "TESTKEY"


@pytest.fixture
def source(tmp_path: Path) -> str:
    path = tmp_path / "profiles.json"
    path.write_text(
        json.dumps([{"name": "PETG Red", "brand": "Polymaker", "material": "PETG", "color_hex": "#FF2200"}]),
        encoding="utf-8",
    )
    return str(path)


@pytest.fixture
def filament_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    target = tmp_path / "BambuStudio" / "user" / "default" / "filament"
    monkeypatch.setattr(bambu_studio, "bambu_filament_dir", lambda preset_folder: target)
    return target


class _SpoolEaseServer:
    """Local SpoolEase stand-in: decrypts requests, records them, returns configured statuses."""

    def __init__(self) -> None:
        self.key = derive_key(SECURITY_KEY)
        self.statuses: dict[str, int] = {}
        self.requests: list[tuple[str, dict]] = []
        server = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:  # noqa: N802
                body = self.rfile.read(int(self.headers["Content-Length"])).decode("ascii")
                server.requests.append((self.path, json.loads(decrypt_text(server.key, body))))
                status = server.statuses.get(self.path, 200)
                reply = encrypt_text(server.key, "{}") if status < 400 else "boom"
                self.send_response(status)
                self.end_headers()
                self.wfile.write(reply.encode("ascii"))

            def log_message(self, *args: object) -> None:
                pass

        self._httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self._httpd.server_address[1]
        threading.Thread(target=self._httpd.serve_forever, daemon=True).start()

    def close(self) -> None:
        self._httpd.shutdown()
        self._httpd.server_close()


@pytest.fixture
def spoolease() -> Iterator[_SpoolEaseServer]:
    server = _SpoolEaseServer()
    yield server
    server.close()


def _run(argv: list[str], capsys: pytest.CaptureFixture[str]) -> tuple[int, dict]:
    code = cli.main(argv)
    return code, json.loads(capsys.readouterr().out)


def _spoolease_args(server: _SpoolEaseServer) -> list[str]:
    return ["--spoolease-host", "127.0.0.1", "--spoolease-port", str(server.port), "--spoolease-security-key", SECURITY_KEY]


def test_skip_spoolease_succeeds(source: str, filament_dir: Path, capsys: pytest.CaptureFixture[str]) -> None:
    code, report = _run(["--source", source, "--skip-spoolease"], capsys)

    assert code == 0
    assert report["results"][0]["bambu_status"] == "written"
    assert report["results"][0]["spoolease_status"] == "skipped"


def test_bambu_write_failure_reports_and_exits_nonzero(
    source: str, filament_dir: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    filament_dir.parent.mkdir(parents=True)
    filament_dir.write_text("not a directory", encoding="utf-8")

    code, report = _run(["--source", source, "--skip-spoolease"], capsys)

    assert code == 1
    assert report["results"][0]["bambu_status"] == "failed"
    assert report["results"][0]["spoolease_status"] == "skipped"
    assert "BambuStudio preset:" in report["results"][0]["detail"]


def test_dry_run_reports_planned_without_network(
    source: str, filament_dir: Path, spoolease: _SpoolEaseServer, capsys: pytest.CaptureFixture[str]
) -> None:
    code, report = _run(["--source", source, "--dry-run", *_spoolease_args(spoolease)], capsys)

    assert code == 0
    assert report["results"][0]["bambu_status"] == "planned"
    assert report["results"][0]["spoolease_status"] == "planned"
    assert spoolease.requests == []
    assert not filament_dir.exists()


def test_apply_writes_both_sides(
    source: str, filament_dir: Path, spoolease: _SpoolEaseServer, capsys: pytest.CaptureFixture[str]
) -> None:
    code, report = _run(["--source", source, *_spoolease_args(spoolease)], capsys)

    assert code == 0
    assert report["results"][0]["bambu_status"] == "written"
    assert report["results"][0]["spoolease_status"] == "written"
    assert [path for path, _ in spoolease.requests] == ["/api/test-key", "/api/filaments-config", "/api/spools/add-edit"]
    assert spoolease.requests[2][1]["rgba"] == "FF2200FF"


def test_custom_filaments_csv_failure_fails_profiles_and_skips_spools(
    source: str, filament_dir: Path, spoolease: _SpoolEaseServer, capsys: pytest.CaptureFixture[str]
) -> None:
    spoolease.statuses["/api/filaments-config"] = 500

    code, report = _run(["--source", source, *_spoolease_args(spoolease)], capsys)

    assert code == 1
    assert report["results"][0]["bambu_status"] == "written"
    assert report["results"][0]["spoolease_status"] == "failed"
    assert report["results"][0]["detail"].startswith("custom filaments CSV: HTTP 500")
    assert [path for path, _ in spoolease.requests] == ["/api/test-key", "/api/filaments-config"]


def test_spool_failure_exits_nonzero(
    source: str, filament_dir: Path, spoolease: _SpoolEaseServer, capsys: pytest.CaptureFixture[str]
) -> None:
    spoolease.statuses["/api/spools/add-edit"] = 500

    code, report = _run(["--source", source, *_spoolease_args(spoolease)], capsys)

    assert code == 1
    assert report["results"][0]["spoolease_status"] == "failed"
    assert report["results"][0]["detail"].startswith("HTTP 500")
