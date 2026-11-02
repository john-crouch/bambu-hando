# bambu-hando

Cross-platform filament profile handoff tool for BambuStudio and SpoolEase.

bambu-hando is an independent project, not affiliated with or endorsed by Bambu Lab or SpoolEase.

It automates three things:
- Load filament profile data from the SpoolmanDB community database, or from your own JSON file or URL
- Create custom filament preset files for BambuStudio (Linux + macOS)
- Register matching custom filaments in SpoolEase, plus one spool per filament carrying its RGBA color (`--skip-spools` registers the filaments only)

## How the three systems are linked

Each filament gets one ID: `slicer_filament_code` from the source if present, otherwise `"P"` + the first 7 hex characters of the MD5 of its name (BambuStudio's own scheme for user filaments). The same ID is written to:

- the BambuStudio preset's `filament_id`
- the SpoolEase custom-filaments CSV code
- the SpoolEase spool's `slicer_filament`

The ID only depends on the name, so re-runs and reordered sources keep the same links. The JSON report lists each profile's `filament_id`.

SpoolEase keeps a single custom-filaments list. Runs merge into it (rows with the same ID are updated, everything else is kept), and if the current list can't be read, nothing is written. Filaments that already have a spool with that ID get no new one, so re-runs don't duplicate inventory. A SpoolEase spool stands for a physical spool: pass `--skip-spools` (or switch off "Create spools" in the TUI) when syncing filaments you don't own yet.

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

It opens on a menu: **Add spools from SpoolmanDB**, **Import** the file given with `--source` (the menu starts on it), **Settings**, or **Quit**; arrow keys or the first letter move, enter chooses. The menu shows the BambuStudio folder, printers and SpoolEase console the run will use. Settings come from BambuStudio, so you rarely need them: enter changes the highlighted row, opening a list of BambuStudio's user folders or a checklist of its printers (space ticks), or toggling a switch, and esc returns to the menu. A file or URL typed into "Import file or URL" appears on the menu as Import. Review the plan table with color swatches and target paths, then press `a` to apply and watch per-profile progress. Any headless flag except `--dry-run`, `--report` and `--max-filaments` prefills the settings, for example `bambu-hando tui --source ./profiles.json`.

When spools will be created, the TUI then asks for each brand's empty spool weight, read from your SpoolEase console:

- A brand with several rows in SpoolEase's spool catalog (or your own "My Spools List", listed first) gets a menu of those rows, for example "Sunlu - Plastic (2.0 Version) - 165g" or "Sunlu - V3 - 179g", followed by the source's weight and Unspecified for a spool that matches none of them. Rows for another spool size, such as 250 g or 3 kg spools, only show up for filaments of that size.
- A brand with exactly one row gets that weight without asking.
- A brand the catalog doesn't list offers the source's weight (SpoolmanDB's, the default) or Unspecified. With Unspecified, SpoolEase works the weight out itself the first time the full spool is weighed.

The plan's Empty column shows the weight each new spool gets.

After the run, `l` on the summary opens labels for the spools it just created: space ticks the fields to show, ←/→ picks a printer (every CUPS destination, printer instances included), and you can type a label size and a path to save the PDF. Enter makes the labels; the summary then says what was printed or saved. Your choices are remembered for next time in `~/.config/bambu-hando/labels.json` (`~/Library/Application Support/bambu-hando` on macOS).

**Add spools from SpoolmanDB** opens a list of brands, then the brand's materials, then its colors, each with how many filaments it has; type the first letters to jump (quickly: "su" finds Sunlu). On the colors, space ticks a color (ctrl+a ticks them all), and enter continues with the ticked colors, from any brand, or with the highlighted one when none is ticked. Esc goes up a level, keeping what's ticked. **Search by name…** at the top of the brands opens a search instead: type to search (every word must appear in the name), tab marks the highlighted filament, ctrl+a marks every match, enter continues with what you marked, and esc returns to the brands. Marks survive changing the search, and `b` on the plan returns to the picker. `--brand`, `--material` and `--match` prefill the search, for example `bambu-hando tui --source spoolmandb --brand Polymaker --skip-spoolease`.

## SpoolmanDB source

`--source spoolmandb` downloads the [SpoolmanDB](https://github.com/Donkie/SpoolmanDB) community filament database (MIT licensed, about 9,000 entries from about 70 manufacturers) and syncs the filaments matching your filters. At least one of `--brand`, `--material` or `--match` is required:

```bash
bambu-hando --source spoolmandb --brand Polymaker --material PETG --match "polylite black" --skip-spoolease --dry-run
```

- `--brand` and `--material` match exactly, ignoring case. Every word in `--match` must appear somewhere in the filament name.
- `--diameter` picks 1.75 (default) or 2.85 mm filaments.
- A run syncs at most 10 filaments, so a broad filter like `--material PLA` (thousands of matches) can't flood BambuStudio and SpoolEase with presets and spools. With more matches it exits 2 before writing anything and lists them; narrow the filters or raise the cap with `--max-filaments <n>`. `--dry-run` is not capped.
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

The SpoolEase host and security key can also come from `SPOOLEASE_HOST` and `SPOOLEASE_SECURITY_KEY`, which keeps the key out of your shell history. If you use the SpoolEase build of BambuStudio, you don't need either: without flags or environment variables, bambu-hando reads the console address and security key from the settings saved by BambuStudio's SpoolEase dialog (`spoolease/config.json` in BambuStudio's config folder). The address's own port is ignored; `--spoolease-port` still applies.

Dry run first:

```bash
bambu-hando \
  --source ./profiles.json \
  --printer-preset "Bambu Lab X1 Carbon 0.4 nozzle" \
  --printer-preset "Bambu Lab X1 Carbon 0.6 nozzle" \
  --spoolease-host 192.168.1.50 \
  --spoolease-security-key YOURKEY \
  --dry-run
```

Apply:

```bash
bambu-hando \
  --source ./profiles.json \
  --printer-preset "Bambu Lab X1 Carbon 0.4 nozzle" \
  --printer-preset "Bambu Lab X1 Carbon 0.6 nozzle" \
  --spoolease-host 192.168.1.50 \
  --spoolease-security-key YOURKEY
```

Empty spool weights follow the TUI's rules, with `--spool-weight <brand>=<grams|spoolmandb|unspecified>` (repeat per brand) in place of the menu. When a brand has several catalog rows and no `--spool-weight`, the run stops with exit code 2 before writing anything and lists one ready-to-paste flag per row:

```text
bambu-hando: error: SpoolEase lists several empty spool weights for these brands; run again with the --spool-weight you want:
  Sunlu (1 filament; SpoolmanDB: 189 g)
    --spool-weight "Sunlu=165"  Sunlu - Plastic (2.0 Version) - 165g
    --spool-weight "Sunlu=202"  Sunlu - Plastic (2.0 Version) - 202g
    ...
```

Single-row brands get their weight automatically, and stderr says which. This happens in dry runs too: they read the key check, the catalog and your spool list from SpoolEase, and write nothing.

Register the filaments in SpoolEase without creating spools:

```bash
bambu-hando --source ./profiles.json --skip-spools
```

Skip SpoolEase writes:

```bash
bambu-hando --source ./profiles.json --skip-spoolease
```

## BambuStudio presets

Each filament becomes one BambuStudio custom filament per printer, built the way BambuStudio's own "Create filament" dialog builds them:

- The tool clones the matching Generic system preset (`Generic PETG` for PETG; `PLA+` falls back to `Generic PLA`), so fan, flow, volumetric-speed, plate-temperature and gcode settings are Bambu's own. It then sets the name, vendor, `filament_id`, color, density, diameter and nozzle range. Bambu's tuned print temperature is kept unless the filament's range excludes it.
- The preset inherits nothing and carries its own `filament_id`, which is what links it to SpoolEase. Filaments without a Generic template for the printer (PVB, GREENTEC, …) fail with a message instead of getting a guessed preset.
- Printers are BambuStudio printer presets such as `Bambu Lab X1 Carbon 0.4 nozzle`; repeat `--printer-preset` for several (the TUI takes a comma-separated list and remembers it for the next run, in `~/.config/bambu-hando/tui.json`). Without it, the printer selected in BambuStudio is used. Unknown names exit 2 with the list of known printers.
- Presets go to the preset folder BambuStudio is using: your numeric user ID when logged in, `default` otherwise (read from `BambuStudio.conf`; `--preset-folder` overrides it). Restart BambuStudio to load new presets; when logged in it then syncs them to your Bambu account like presets you create yourself.
- Presets that already exist are kept as they are and reported as `skipped`, so tuning you do in BambuStudio (flow, temperatures, fans) survives re-runs; only missing ones are written, such as a newly added printer. `--overwrite-presets` (the TUI's "Overwrite presets" toggle) replaces them with freshly generated ones.

The system profiles are read from BambuStudio's own install, so BambuStudio must have run at least once. Paths:

Linux:
- ~/.config/BambuStudio/system (templates), ~/.config/BambuStudio/BambuStudio.conf
- ~/.config/BambuStudio/user/<preset-folder>/filament/base (written presets)

macOS:
- the same under ~/Library/Application Support/BambuStudio

## Spool labels

`bambu-hando labels` makes QR labels for spools already in SpoolEase:

```bash
bambu-hando labels --spool-id 7 --output labels.pdf          # one spool
bambu-hando labels --brand sunlu --printer Label-Printer       # print straight to a CUPS printer
bambu-hando labels --all --fields qr,brand,material,color,id --size 40x30mm --output labels.pdf
```

- The output is a PDF with one page per label, each page exactly the label's size (57×32 mm by default, the common 2.25×1.25 in roll; `--size` takes inches or millimeters), so any printer can print it. Measure your labels: a page larger than the label bleeds off its edges and onto the next one. The QR code is drawn as vector shapes and the text uses Helvetica, so labels stay sharp at a thermal printer's 203 dpi.
- `--printer <name>` prints through CUPS (`lp`), asking for the label size as the media (`media=Custom.57x32mm`); `--print-option key=value` passes printer options such as `Darkness=15` along. `lpstat -p` lists printer names. To keep settings like darkness for spool labels only, save them as a CUPS printer instance and print to that: `lpoptions -p <printer>/spools -o Darkness=15`, then `--printer <printer>/spools`. Thermal label drivers often take sizes in whole millimeters, so give `--size` in millimeters when the label is metric.
- `--fields` picks what the label shows; `bambu-hando labels --help` lists them all (brand, material, filament name, color name, color code, nozzle temperatures, label and empty weight, filament code, location, date added, note, spool ID). Fields always print in the same order, and ones a spool has no value for are left out. Text shrinks to fit and long lines end in "…".
- A sync can make the labels for the spools it creates: `--label-output <file.pdf>` and/or `--label-printer <name>`, with `--label-fields` and `--label-size` like `--fields` and `--size` here. Only spools that run created get labels; the report's `labels` entry says what happened (`written`, `planned` in a dry run, `skipped` when no spool was created, `failed` exits 1 after the sync itself is done).
- The QR code holds SpoolEase's own spool link, the one its NFC tags carry: `https://tag.spoolease.io/S1/?ID=<spool id>&M=…&B=…`. Scanning it with a phone shows SpoolEase's spool card. The SpoolEase console has no QR scanner, and its inventory page can't open one spool from a link, so the ID on the card is how you find the spool there.

## Safety behavior

- Uses dry-run mode for planning (no files written, nothing sent to SpoolEase beyond the key check and reading its spool weight lists)
- Writes Bambu preset files atomically via temp file replacement
- Produces JSON report output for auditability; each profile gets a `bambu_status` and `spoolease_status` of `written`, `planned`, `skipped` or `failed`, a `core_weight_g`: the empty spool weight its new spool gets (0 for unspecified, `null` when the run creates no spools), and a `spool_id`: the ID SpoolEase gave the spool this run created (`null` when it created none). `labels` is `null` unless labels were asked for
- Exit codes: `0` success, `1` a profile failed, `2` invalid arguments, BambuStudio not set up (no system profiles, unknown printer) or SpoolEase key check failed

## Development

```bash
npm test                              # build, then run all tests
npx vitest run test/colors.test.ts    # one file
npx vitest run -t "masks the security key"   # one test by name
npm run typecheck
```

## Limitations

See docs/assumptions.md for known inferred fields and constraints.

## License

MIT, see `LICENSE`. The test fixtures include data from BambuStudio, SpoolmanDB and SpoolEase under their own licenses, listed in `THIRD_PARTY.md`.
