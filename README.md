# bambu-hando

Cross-platform filament profile handoff tool for BambuStudio and SpoolEase.

It automates three things:
- Load filament profile data from the SpoolmanDB community database, or from your own JSON file or URL
- Create custom filament preset files for BambuStudio (Linux + macOS)
- Register matching custom filaments in SpoolEase, and optionally (`--create-spools`) one spool per filament carrying its RGBA color

## How the three systems are linked

Each filament gets one ID: `slicer_filament_code` from the source if present, otherwise `"P"` + the first 7 hex characters of the MD5 of its name (BambuStudio's own scheme for user filaments). The same ID is written to:

- the BambuStudio preset's `filament_id`
- the SpoolEase custom-filaments CSV code
- the SpoolEase spool's `slicer_filament` (with `--create-spools`)

The ID only depends on the name, so re-runs and reordered sources keep the same links. The JSON report lists each profile's `filament_id`.

SpoolEase keeps a single custom-filaments list. Runs merge into it (rows with the same ID are updated, everything else is kept), and if the current list can't be read, nothing is written. With `--create-spools`, filaments that already have a spool with that ID are skipped, so re-runs don't duplicate inventory. Spool creation is off by default because a SpoolEase spool stands for a physical spool.

## Why this exists

If you have many filaments and are relying on defaults, this tool reduces repetitive manual setup and keeps BambuStudio + SpoolEase in sync.

## Scope

- Supported OS: Linux, macOS
- Supported printer workflow: Bambu Lab with SpoolEase ecosystem
- Works with LAN-only + Developer mode workflows where SpoolEase integrations are available

## Install

Requires Node.js 22 or newer.

```bash
npm install
npm run build
npm link   # puts bambu-hando on your PATH
```

## Interactive TUI

```bash
bambu-hando tui
```

Fill in the setup form (arrow keys move, space toggles, enter loads the plan), review the plan table with color swatches and target paths, then press `a` to apply and watch per-profile progress. Any headless flag except `--dry-run` and `--report` prefills the form, for example `bambu-hando tui --source ./profiles.json`.

With `spoolmandb` as the source, a picker opens before the plan: type to search (every word must appear in the name), tab marks the highlighted filament, ctrl+a marks every match, enter continues with what you marked, and esc returns to the form. Marks survive changing the search, and `b` on the plan returns to the picker. `--brand`, `--material` and `--match` prefill the search, for example `bambu-hando tui --source spoolmandb --brand Polymaker --skip-spoolease`.

## SpoolmanDB source

`--source spoolmandb` downloads the [SpoolmanDB](https://github.com/Donkie/SpoolmanDB) community filament database (MIT licensed, about 9,000 entries from about 70 manufacturers) and syncs the filaments matching your filters. At least one of `--brand`, `--material` or `--match` is required:

```bash
bambu-hando --source spoolmandb --brand Polymaker --material PETG --match "polylite black" --skip-spoolease --dry-run
```

- `--brand` and `--material` match exactly, ignoring case. Every word in `--match` must appear somewhere in the filament name.
- `--diameter` picks 1.75 (default) or 2.85 mm filaments.
- Profiles are named `<manufacturer> <material> <product>`; the material is left out when the product name already contains it (`Polymaker PolyLite™ PETG Black`).
- Nozzle temperatures come from the filament, then from SpoolmanDB's per-material defaults, then fall back to 190-240 °C. Spools get the filament's net and empty-spool weights (0, meaning unknown, when SpoolmanDB doesn't list a spool weight).
- Multi-color filaments use their first color.
- Bambu Lab filaments are never included: BambuStudio already ships system presets for them, and a custom copy would not link to those.

The database is cached in `~/.cache/bambu-hando/` (`$XDG_CACHE_HOME` is honored; `~/Library/Caches/bambu-hando/` on macOS). Each run revalidates it with its ETag, and when SpoolmanDB can't be reached the cached copy is used with a warning. `SPOOLMANDB_URL` overrides the download location (default `https://donkie.github.io/SpoolmanDB`).

## Input source format

Instead of SpoolmanDB you can provide your own JSON file or URL. Example:

```json
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
    "weight": 1000,
    "spool_weight": 200,
    "slicer_filament_code": "PABC1234"
  }
]
```

`weight` (net filament) and `spool_weight` (empty spool) are in grams and go to SpoolEase spools; they default to 1000 and 200.

## Headless run

The SpoolEase host and security key can also come from `SPOOLEASE_HOST` and `SPOOLEASE_SECURITY_KEY`, which keeps the key out of your shell history.

Dry run first:

```bash
bambu-hando \
  --source ./profiles.json \
  --preset-folder default \
  --printer-preset "Bambu Lab X1C 0.4 nozzle" \
  --spoolease-host 192.168.1.50 \
  --spoolease-security-key YOURKEY \
  --dry-run
```

Apply:

```bash
bambu-hando \
  --source ./profiles.json \
  --preset-folder default \
  --printer-preset "Bambu Lab X1C 0.4 nozzle" \
  --spoolease-host 192.168.1.50 \
  --spoolease-security-key YOURKEY
```

Skip SpoolEase writes:

```bash
bambu-hando --source ./profiles.json --skip-spoolease
```

## BambuStudio paths used

Linux:
- ~/.config/BambuStudio/user/<preset-folder>/filament

macOS:
- ~/Library/Application Support/BambuStudio/user/<preset-folder>/filament

## Safety behavior

- Uses dry-run mode for planning
- Writes Bambu preset files atomically via temp file replacement
- Produces JSON report output for auditability; each profile gets a `bambu_status` and `spoolease_status` of `written`, `planned`, `skipped` or `failed`
- Exit codes: `0` success, `1` a profile failed, `2` invalid arguments or SpoolEase key check failed

## Development

```bash
npm test                              # build, then run all tests
npx vitest run test/colors.test.ts    # one file
npx vitest run -t "masks the security key"   # one test by name
npm run typecheck
```

## Limitations

See docs/assumptions.md for known inferred fields and constraints.
