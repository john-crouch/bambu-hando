"""ABOUTME: CLI entrypoint for the BambuStudio + SpoolEase filament handoff flow.
ABOUTME: Implements dry-run, idempotent writes, and source-driven batch sync."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from .bambu_studio import write_many
from .models import SyncResult
from .sources import load_profiles
from .spoolease import SpoolEaseClient, SpoolEaseConnection, build_custom_filaments_csv


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="bambu-hando",
        description="Sync filament profiles into BambuStudio custom presets and SpoolEase",
    )
    parser.add_argument("--source", required=True, help="JSON file or URL with filament profiles")
    parser.add_argument("--preset-folder", default="default", help="BambuStudio user preset folder")
    parser.add_argument("--printer-preset", default="Bambu Lab X1C 0.4 nozzle", help="Printer preset suffix")
    parser.add_argument("--dry-run", action="store_true", help="Plan operations without writing")

    parser.add_argument("--spoolease-host", default="", help="SpoolEase console host or IP")
    parser.add_argument("--spoolease-security-key", default="", help="SpoolEase security key")
    parser.add_argument("--spoolease-port", type=int, default=80, help="SpoolEase port")
    parser.add_argument("--spoolease-https", action="store_true", help="Use HTTPS for SpoolEase")
    parser.add_argument("--skip-spoolease", action="store_true", help="Skip SpoolEase API updates")

    parser.add_argument("--report", default="", help="Optional output report path")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    profiles = load_profiles(args.source)

    preset_paths = write_many(
        profiles=profiles,
        preset_folder=args.preset_folder,
        printer_preset=args.printer_preset,
        dry_run=args.dry_run,
    )

    results: list[SyncResult] = []
    bambu_status = "planned" if args.dry_run else "written"

    if args.skip_spoolease:
        for p in profiles:
            results.append(SyncResult(profile_name=p.name, bambu_status=bambu_status, spoolease_status="skipped", detail="SpoolEase skipped"))
    else:
        if not args.spoolease_host or not args.spoolease_security_key:
            parser.error("SpoolEase host and security key are required unless --skip-spoolease is set")

        conn = SpoolEaseConnection(
            console_host=args.spoolease_host,
            security_key=args.spoolease_security_key,
            port=args.spoolease_port,
            use_https=args.spoolease_https,
        )
        client = SpoolEaseClient(conn)

        if not args.dry_run and not client.test_key():
            print("SpoolEase key validation failed", file=sys.stderr)
            return 2

        csv_payload = build_custom_filaments_csv(profiles)
        csv_error = ""

        if not args.dry_run:
            status_csv, msg_csv = client.set_custom_filaments_csv(csv_payload)
            if status_csv >= 400:
                print(f"Failed to set custom filaments CSV: {status_csv} {msg_csv}", file=sys.stderr)
                csv_error = f"custom filaments CSV: HTTP {status_csv}: {msg_csv[:120]}"

        for p in profiles:
            if args.dry_run:
                results.append(SyncResult(profile_name=p.name, bambu_status=bambu_status, spoolease_status="planned", detail="dry-run"))
                continue
            # Spools reference filament codes from the CSV, so creating them after a CSV failure would leave SpoolEase half-configured.
            if csv_error:
                results.append(SyncResult(profile_name=p.name, bambu_status=bambu_status, spoolease_status="failed", detail=csv_error))
                continue
            status, msg = client.add_or_edit_spool(p)
            spoolease_status = "written" if status < 400 else "failed"
            results.append(SyncResult(profile_name=p.name, bambu_status=bambu_status, spoolease_status=spoolease_status, detail=f"HTTP {status}: {msg[:120]}"))

    report = {
        "source": args.source,
        "dry_run": args.dry_run,
        "profiles_count": len(profiles),
        "bambu_preset_paths": [str(p) for p in preset_paths],
        "results": [r.__dict__ for r in results],
    }

    out = json.dumps(report, indent=2)
    print(out)

    if args.report:
        Path(args.report).write_text(out + "\n", encoding="utf-8")

    return 1 if any(r.failed for r in results) else 0


if __name__ == "__main__":
    raise SystemExit(main())
