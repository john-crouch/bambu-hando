# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`bambu-hando`: a Node/TypeScript CLI + Ink TUI that reads filament profiles (from the SpoolmanDB community database, or a JSON file/URL) and pushes them to two places at once:
1. BambuStudio custom filament preset JSON files on disk (Linux + macOS only)
2. A SpoolEase console over its encrypted LAN REST API (custom-filaments CSV + one spool record per profile)

It was ported from Python; the Python code lives only in git history (before `bfac163`).

## Commands

```bash
npm test                                   # tsc build to dist/, then vitest run (e2e needs dist/)
npx vitest run test/colors.test.ts         # single file
npx vitest run -t "masks the security key" # single test by name
npm run typecheck                          # tsc over src + test, no emit
node dist/bin.js --source test/fixtures/source.json --skip-spoolease --dry-run   # headless
node dist/bin.js tui --source test/fixtures/source.json                         # TUI (needs a real TTY)
```

ESM with `module: nodenext`: relative imports must use `.js` extensions even from `.ts`/`.tsx`. Dependencies are pinned exact (`--save-exact`); prefer versions at least two weeks old.

## Architecture

- **`sync.ts` is the core**, shared by both front ends: `runSync(options, onEvent)` writes all presets first (`writeMany`), then SpoolEase: `testKey` → `setCustomFilamentsCsv` → `addOrEditSpool` per profile. It emits `stage` / `preset` / `spool` / `warning` events for live progress and returns `{ presets, results }`. Key rejection or an unreachable console throws `KeyCheckError` before anything is sent. A failed CSV upload marks every profile's SpoolEase status failed and skips spool creation (spools reference CSV codes). Network errors become `failed` statuses, never crashes.
- **Linking**: `FilamentProfile.filamentId` (source `slicer_filament_code`, else `"P"` + md5(name)[0:7], BambuStudio's scheme) is the single ID in the preset's `filament_id`, the SpoolEase CSV code, and spool `slicer_filament`. Verified upstream: BambuStudio reads top-level `filament_id` from user preset JSON (`Preset.cpp`); SpoolEase stores ONE custom-filaments CSV and overwrites it on POST (`app_config.rs set_filaments`), parses it with naive `split(',')` (so names must be comma-free), and creates a new spool for every add-edit with empty `id`. Hence sync GETs and merges the CSV before writing (never writes if the read fails), and with `createSpools` GETs `/api/spools` (headerless CSV, `slicer_filament` is column 12) to skip existing ones. Spools are created by default; `--skip-spools` / the TUI's "Create spools" toggle turn them off.
- **Statuses**: each `SyncResult` has `bambuStatus` / `spooleaseStatus` of `written`, `planned` (dry-run: no disk, no writes to SpoolEase), `skipped`, or `failed`. Only `failed` → exit 1; `KeyCheckError` and usage errors → exit 2.
- **Headless CLI** (`cli.ts`, entry `bin.ts`): `util.parseArgs`, flags identical to the old Python CLI, `SPOOLEASE_HOST` / `SPOOLEASE_SECURITY_KEY` env fallbacks, then the SpoolEase build of BambuStudio's saved settings (`spooleaseConfig.ts`, also prefills the TUI; only address and key are read, never printed), prints a **snake_case** JSON report (kept for compatibility with consumers of the Python report). `main(argv, io)` takes injectable stdout/stderr for tests; `bin.ts` exists only so importing `cli.ts` has no side effects.
- **Empty spool weights** (`spoolWeights.ts`): before `runSync`, and only when spools are created, both front ends `checkKey` then read SpoolEase's `/spools-catalog` (plain text) and `/api/spools-config` (the user's list), dry-run included, and group profiles by brand (`brandKey`: letters and digits). Rules: one catalog row → used without asking; several → TUI menu (`WeightMenu.tsx`, pure `weightInput`) or headless exit 2 listing ready-to-paste `--spool-weight "<brand>=<grams>"` lines; none → source's weight (default) or unspecified (0, which SpoolEase fills in on the first full weigh). Unreadable lists → warning, source weights.
- **TUI** (`src/tui/`): `cli.ts` dynamically imports `tui/run.tsx` so headless runs never load React/Ink. `App.tsx` is a screen state machine (form → loading → [pick, SpoolmanDB only] → [weights, when creating spools] → plan → running → done | error) and calls `onExit(code)` with the same exit-code semantics as headless.
- **SpoolmanDB** (`spoolmanDb.ts`, `--source spoolmandb`): downloads `filaments.json` + `materials.json` from `SPOOLMANDB_URL` (default GitHub Pages) into `cacheDir()` (`paths.ts`), revalidates with ETag/If-None-Match, falls back to the cache with a warning when the download fails. `catalogProfiles` maps entries onto profiles of one diameter: name `<manufacturer> [material] <product>` (zero collisions across the real database), first weight variant wins, Bambu Lab excluded (BambuStudio ships system presets with their own IDs), temps from entry → `materials.json` → 190-240. `filterProfiles` does brand/material (exact, ignoring case) and `--match` words. The headless CLI requires at least one filter; no match → exit 2.
- **`FilamentProfile`** (`models.ts`) is the single normalized model; JSON-source defaulting happens in `sources.ts`, SpoolmanDB mapping in `spoolmanDb.ts`. `labelWeight`/`coreWeight` are whole grams because SpoolEase's `AddSpoolDTO` takes `i32`, and 0 means unknown there. Colors are always 8-char uppercase RGBA (`colors.ts`); BambuStudio gets `#RRGGBB`.
- **BambuStudio presets** (`bambuStudio.ts`, `bambuProfiles.ts`) mirror BambuStudio's "Create filament": `SystemProfiles` loads the BBL bundle from `<config>/system` (Generic presets + ancestors, instantiable printers), `template(material, printer)` picks the Generic preset to clone, `buildPreset` merges its resolved settings with the filament's identity (`inherits: ""`, own `filament_id`, `compatible_printers: [printer]`, `version` from the bundle; BambuStudio skips user presets without one). One file per printer, named `<name> @<printer>.json` (BambuStudio derives the preset name from the file name) under `user/<preset_folder>/filament/base/`. `runSync` throws `SetupError` (exit 2) for missing system profiles or unknown printers before writing anything. Existing preset files are kept (`kept` in `PresetOutcome`, `skipped` status when all are) unless `overwritePresets` / `--overwrite-presets`, so BambuStudio-side tuning survives re-runs. Preset folder and printer default to `BambuStudio.conf` (`bambuDefaults`). Writes are atomic (`.tmp` + rename). Read `docs/assumptions.md` first: it cites the BambuStudio source behind each of these.
- **SpoolEase crypto** (`encryption.ts`): PBKDF2-HMAC-SHA256(key, salt `"example_salt"`, 10k iterations, 32 bytes); wire = no-pad base64(12-byte nonce, always 16 chars) + no-pad base64(ciphertext‖16-byte GCM tag), `Content-Type: application/text`. These mirror SpoolEase itself; changing them breaks compatibility.

## Testing

- `test/fixtures/python-parity.json` holds reference outputs captured from the Python implementation (preset JSON, CSV, spool payloads, AES vectors from `test/fixtures/source.json`). Preset parity was dropped on purpose when presets became full Generic clones; CSV, spool and AES parity remain. Parity tests must keep matching it byte for byte; don't regenerate it to make a test pass.
- `test/fixtures/spoolmandb/` holds 12 real SpoolmanDB entries chosen to cover edge cases (weight/diameter variants, cross-material name clash, multi-color, 8-digit hex, missing temps/spool weight, Bambu Lab) plus the real `materials.json`. `test/spoolmanDbServer.ts` serves them with ETags, records requests, and `failWith` forces errors.
- `test/spooleaseServer.ts` is a real local HTTP server speaking the encrypted protocol (wrong key → 401). It keeps device-like state (`customFilaments`, `spools`, seedable), records `{method, path, body}`, and `server.replies` overrides by `"METHOD /path"` or `"/path"`.
- Parity tests keep the original Python outputs untouched and apply intentional changes on top explicitly (`expectedCsv`, `expectedSpoolPayload` in `test/parity.ts`).
- `test/fixtures/bambustudio/system/` is a trimmed real BBL bundle (Generic PLA/PETG/PETG HF/ABS/PLA-CF/HIPS/TPU chains, X1 Carbon 0.4/0.6). `installBambuStudio(home, conf)` in `test/bambuStudioSetup.ts` copies it and writes `BambuStudio.conf` into a temp HOME; every test that syncs needs it.
- BambuStudio output is redirected with `vi.stubEnv("HOME", tmp)` (`os.homedir()` reads `HOME`).
- TUI has two layers: `test/tui.test.tsx` (in-process, `ink-testing-library`, ~30ms settle between keystrokes, `vi.waitFor` on `lastFrame()`) and `test/tui.e2e.test.ts` (built binary inside a real PTY via node-pty; `Terminal.waitFor` only matches text rendered after the previous match). The PTY env is deliberately minimal: CI-like variables switch Ink to non-interactive rendering.
- Keep `App`'s `useInput` always active and branch on the screen. The SpoolmanDB picker (`Picker.tsx`) follows this: it has no listener of its own; `App` feeds keys to the pure `pickerInput()` and keeps `PickerState`, so the picker is unit-tested without rendering.
- The PTY `Terminal.waitFor` also waits (once) until `stty` reports `-icanon` on the pty: Ink draws its first frame before raw mode is on, and a key sent in that window goes through the cooked line discipline and is lost. Toggling `isActive` re-attaches Ink's listener in a post-render effect, which drops keys pressed right after a screen change (this showed up as flaky tests under load).
- Exiting the TUI without `onExit` means Ink handled ctrl+c, so `run.tsx` returns 130.

## Docs

`docs/assumptions.md` separates documented facts from inferred behavior: read it before touching preset fields or SpoolEase payloads. `docs/testing.md` lists the manual live-validation sequence.
