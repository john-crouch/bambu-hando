# Testing Plan

## Automated tests

Run everything with `npm test` (builds `dist/` first, then runs Vitest).

- Unit: colors, paths, source parsing, encryption, preset JSON, SpoolEase payloads
- Parity: preset JSON, custom-filaments CSV, spool payloads, and AES-GCM vectors must match
  reference outputs captured from the original Python implementation
  (`test/fixtures/python-parity.json`)
- Integration: sync orchestration, headless CLI, and the Ink TUI against a local HTTP server
  that speaks the real encrypted SpoolEase protocol, with BambuStudio output in a temporary HOME
- E2E: spawns the built `dist/bin.js` as a real process, and runs the TUI inside a real
  pseudo-terminal via node-pty (keystrokes, rendered frames, cursor restore, exit codes
  including 130 on ctrl+c)

## Recommended live validation

1. Run dry-run with 1-2 profiles.
2. Verify planned BambuStudio target paths.
3. Verify SpoolEase key check passes.
4. Run apply mode.
5. Open BambuStudio and inspect custom filament list.
6. Open SpoolEase inventory and confirm spool entries/color values.
7. Make a label for one of those spools (`bambu-hando labels --spool-id <id> --output label.pdf`), check it scans at the printer's resolution (`pdftoppm -r 203 -mono -png label.pdf label && zbarimg --raw label-1.png`), print it (`--printer <name>`), and scan the printed label with a phone: SpoolEase's spool card should show the same ID.

## Suggested cross-platform verification

- Linux Mint machine: run full flow
- macOS machine: run dry-run and apply with same source file
- Compare generated report JSON outputs
