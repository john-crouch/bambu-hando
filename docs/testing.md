# Testing Plan

## Automated tests included

- Color normalization and RGB conversion
- Linux/macOS path resolution logic
- SpoolEase encryption/decryption roundtrip
- JSON source parsing and normalization

## Recommended live validation

1. Run dry-run with 1-2 profiles.
2. Verify planned BambuStudio target paths.
3. Verify SpoolEase key check passes.
4. Run apply mode.
5. Open BambuStudio and inspect custom filament list.
6. Open SpoolEase inventory and confirm spool entries/color values.

## Suggested cross-platform verification

- Linux Mint machine: run full flow
- macOS machine: run dry-run and apply with same source file
- Compare generated report JSON outputs
