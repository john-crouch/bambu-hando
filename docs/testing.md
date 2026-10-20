# Testing Plan

## Automated tests

Run everything with `npm test` (builds `dist/` first, then runs Vitest).

- Unit: colors, paths, source parsing, encryption, preset JSON, SpoolEase payloads
- Parity: preset JSON, custom-filaments CSV, spool payloads, and AES-GCM vectors must match
  reference outputs captured from the original Python implementation
  (`test/fixtures/python-parity.json`)
- Integration: sync orchestration, headless CLI, and the Ink TUI against a local HTTP server
  that speaks the real encrypted SpoolEase protocol, with BambuStudio output in a temporary HOME
- E2E: spawns the built `dist/bin.js` as a real process

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
