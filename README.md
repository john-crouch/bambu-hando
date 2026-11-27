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

A full-screen app with five tabs along the top: **Spools**, **Add**, **Presets**, **Check** and **Settings**. `tab` and `shift+tab` move between them, `←` `→` move between a tab's pages, `?` shows what every key does where you are, and `ctrl+k` finds any action by name. Nothing is written until a review page or a confirm dialog has named every target and you press `a`. `q` quits (it asks first when edits would be lost, and waits while something is being written); `ctrl+c` quits at once. The session's results are printed after the app closes, and its exit code follows the worst of them (`1` when a write failed, `2` for a rejected key or a setup problem).

- **Spools** (where it opens when a SpoolEase console is set up): every spool on the console with the filament left on it (SpoolEase's own figure), a fill bar, its location and the date it was added; `/` filters, `s` sorts, `space` ticks. The panel beside it shows the spool in full. `l` makes labels for the ticked spools, `+` adds more spools like the highlighted one (copies of its filament's newest spool: nothing changes in BambuStudio or the custom filaments list), and `b` scans a barcode (a USB or Bluetooth scanner that types like a keyboard; the first time, you pick which filament it is, kept in `~/.config/bambu-hando/barcodes.json`).
- **Add**: pages Find → Weights → Review → Done. Find drills into SpoolmanDB by brand, material and color (or the file or URL from Settings › Import), `/` searches the whole catalog, `space` ticks, and a color list ends with **Other color…** for one SpoolmanDB doesn't list. The panel beside it says what adding the highlighted filament would write, checked against what's already there. Weights asks for each brand's empty spool weight when SpoolEase's spool catalog has several (see below). Review shows, per filament, what happens to its presets (`+ new`, `= kept`, `↻ replace`) and on SpoolEase; `e` opens the preset the run would write in the preset editor; `a` runs it, and Done offers labels for the new spools. Your 3DFilamentProfiles spools are a source too, one `esc` up from SpoolmanDB's brands: it lists those not linked to this console yet, ticked ones go straight to a Review that names every target and the API calls it costs, and `a` imports them as [`3dfp import`](#bringing-3dfp-spools-into-bambustudio-and-spoolease) does (the empty spool weight comes from 3DFP, so there's no Weights page).
- **Presets**: your BambuStudio filament presets, grouped by filament, with their key settings beside the list; enter opens the editor (see [Editing presets](#editing-presets)).
- **Check**: the sync check (see [Sync check](#sync-check)); enter on a problem takes you to what fixes it, and `f` gives presets without a filament ID one.
- **Settings**: pages for BambuStudio (preset folder, printers, overwrite), SpoolEase (host, port, security key, HTTPS, `t` tests the connection), Labels and Import. The printers, the SpoolEase console (the key in the system keyring, see [API keys](#api-keys)) and label choices are remembered for next time.

When spools will be created, Weights asks for each brand's empty spool weight, read from your SpoolEase console:

- A brand with several rows in SpoolEase's spool catalog (or your own "My Spools List", listed first) gets a choice of those rows, for example "Sunlu - Plastic (2.0 Version) - 165g". Your choice is remembered per brand.
- A brand with exactly one row gets that weight without asking.
- A brand the catalog doesn't list offers the source's weight (SpoolmanDB's, the default) or Unspecified. With Unspecified, SpoolEase works the weight out itself the first time the full spool is weighed.

Any headless flag except `--dry-run`, `--report` and `--max-filaments` prefills the TUI, for example `bambu-hando tui --source ./profiles.json` (it then opens on Add with that file), or `--brand`, `--material` and `--match` to open Add's search on them.

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
    "slicer_filament_code": "PABC1234",
    "print_temp": 245,
    "bed_temp": 75,
    "flow_ratio": 0.96,
    "max_volumetric_speed": 14
  }
]
```

`weight` (net filament) and `spool_weight` (empty spool) are in grams and go to SpoolEase spools; they default to 1000 and 200. `print_temp`, `bed_temp`, `flow_ratio` and `max_volumetric_speed` are optional and go into the presets; any you leave out keep the Generic preset's value.

## Headless run

The SpoolEase host and security key can also come from `SPOOLEASE_HOST` and `SPOOLEASE_SECURITY_KEY`, which keeps the key out of your shell history. Without either, bambu-hando uses the key you saved (`bambu-hando key set spoolease`, or the TUI's Settings, which keeps it in the system keyring) and the host, port and HTTPS saved by the TUI's Settings, and then, if you use the SpoolEase build of BambuStudio, the address and key saved by BambuStudio's SpoolEase dialog (`spoolease/config.json` in BambuStudio's config folder; its address's own port is ignored). Flags always win; `--no-spoolease-https` turns off an HTTPS saved earlier.

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

- The tool clones the matching Generic system preset (`Generic PETG` for PETG; `PLA+` falls back to `Generic PLA`), sets the name, vendor, `filament_id`, color, density, diameter and nozzle range, then writes every print setting the filament's source has over Generic's: print temperature, bed temperature (smooth and textured PEI and the engineering plate; the cool and supertack plates keep Generic's, where 0 means the plate can't take the filament), flow ratio and max volumetric speed. The order is your own calibration on a 3DFP spool, then 3DFP's record, then SpoolmanDB (the entry's value, else the middle of its range, else its material's) or your JSON file; Generic fills in only what none of them has, such as fan and gcode settings. Bambu's tuned print temperature is kept only when the source has none, and then only inside the filament's range.
- With [filament-db](#manufacturer-presets-from-filament-db)'s export, a manufacturer's own preset for your printer and nozzle goes over Generic's, and community values only fill in what it leaves out.
- Pressure advance is turned on in the preset only with your own calibrated K (a community K is stored but left off). BambuStudio doesn't send a preset's K to Bambu printers anyway; they use their own flow-dynamics calibration.
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

### Manufacturer presets from filament-db

filament-db, a separate tool, collects manufacturers' own slicer presets (Polymaker's, so far) and tags every value with how far to trust it. Its export, `filament-db export --format json --out`, writes `~/.local/share/filament-db/export/catalog.json` (or `$XDG_DATA_HOME/filament-db/…`; `FILAMENT_DB_EXPORT` points bambu-hando at another file). bambu-hando reads it when it's there; without it everything works as before. An export of another `schema_version` is ignored with a warning.

A filament's product line is found only by id: a SpoolmanDB profile's entry id, a 3DFP spool's filament id, never its name. A JSON file's profiles have neither, so they're never matched. Each printer file is built in this order, later winning:

1. BambuStudio's Generic preset, as without the export;
2. the manufacturer's preset for that printer and nozzle (or one that covers it: the X1, X1 Carbon and P1S take each other's), all of it, except values filament-db marks suspect (such as a 0.2 nozzle preset that kept the 0.4's max volumetric speed), which leave Generic's;
3. without such a preset (a 0.6 nozzle, say), the line's manufacturer material settings: nozzle range, density, softening point, drying;
4. the source's community values (SpoolmanDB, 3DFP's record) only for keys no manufacturer value covers. A value a manufacturer's preset kept from Generic stays Generic's (a community bed temperature doesn't replace it), clamped into the manufacturer's nozzle range;
5. your own calibration on a 3DFP spool, always.

When the line has a manufacturer nozzle range, SpoolEase's custom filament row gets it too. The 3DFP records filament-db holds also save API calls: bambu-hando takes one under 30 days old instead of fetching it (`3dfp filament`, the import and its preview).

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

## Sync check

`bambu-hando check` is the TUI's Check tab without the TUI: it compares the preset folder's presets with the console's custom filaments and spools, prints the report, and changes nothing. Problems are what breaks the link between a spool and its preset in the AMS (a custom filament with no preset, a spool whose filament code SpoolEase doesn't list, a custom filament row SpoolEase misreads); notes are worth knowing but harmless (presets the console doesn't know, presets without a filament ID, spools without a filament code).

```bash
bambu-hando check                         # text report
bambu-hando check --json > check.json     # snake_case JSON: summary, sections, warnings
```

In the TUI, `f` on the Check tab gives presets without a filament ID (missing, or the string `"null"`, seen in presets made outside BambuStudio's Create filament) the ID Create filament would give them, `P` plus the start of the md5 of the filament's name, the same for every printer's preset. It lists each file and its ID first and writes nothing until `a`; logged in, BambuStudio uploads the change on its next sync. A preset that has an ID by the time `a` is pressed is left alone.

`bambu-hando check` exits `0` when there are no problems (notes don't count), `1` when there are, and `2` for invalid arguments or a rejected key, so it works from cron or a script after changing presets in BambuStudio. `--preset-folder` and the SpoolEase flags work as for a sync, with the same defaults.

## Editing presets

The **Presets** tab lists the preset folder's filament presets, grouped by filament (presets that copy a system preset aren't listed; the list says how many), and `/` filters by name, printer or filament ID. Enter opens the editor: one page per group (nozzle temperatures and range, bed plates, flow, retraction, cooling, filament), `←` `→` or `1`-`7` to move, and a last page with every setting as raw text. A field opens with its value selected, so typing replaces it; numbers also step with the arrow keys (shift for ×5), shown as `‹ 245°C ›`. `u` undoes a field. Unsaved edits are kept per preset for the session, and quitting with some asks first.

**Nozzle types.** BambuStudio keeps some settings once per nozzle type in a preset (standard and high flow, for example max volumetric speed `standard 22 · high flow 29 mm³/s`). An edit goes to the type your printer uses, from BambuStudio's own settings (Standard when it has none), marked `●`; another type that held the same old value changes with it, and one that was set apart stays. `n` writes the field to every type instead.

**Nozzle sizes.** A filament has one preset per printer, so one per nozzle size (`@… 0.4 nozzle`, `@… 0.6 nozzle`). Review lists each change for each of the filament's presets with that preset's own before → after: settings of the material (temperatures, flow ratio, fans, color, density, cost) are ticked for every preset, and settings of the nozzle (max volumetric speed, pressure advance, retraction, and anything changed on the raw page) only for the preset you opened, so a 0.4 tune doesn't reach the 0.6 unless you tick it. Nothing is written until `a`. Each preset is read again and only its ticked changes are written, in BambuStudio's layout, with its `.info` dated so BambuStudio uploads the change on its next sync; a preset that fails to save keeps its changes as a draft. Close BambuStudio first, or it may save its own copy over the change. A changed nozzle range also goes into SpoolEase's custom filament row when the console is set up.

A later sync of the same filament keeps that range: a preset it keeps (the default) gives SpoolEase its own nozzle range rather than the source's, and the plan's Nozzle°C column shows the range SpoolEase gets. With several printers, the first kept preset that has a range wins.

## API keys

`bambu-hando key` keeps keys in the system keyring: the macOS Keychain, or the Secret Service on Linux (GNOME Keyring, KWallet). They never go into a file bambu-hando writes, and on Linux they never fall back to the kernel keyring, which forgets them on reboot. There are two: `3dfp`, a 3DFilamentProfiles API key (they start with `3dfp_`, which `key set` checks), and `spoolease`, your SpoolEase console's security key (the TUI's Settings saves it here too).

```bash
bambu-hando key set 3dfp            # hidden prompt: paste the key, press enter
pass show 3dfp | bambu-hando key set 3dfp   # or pipe it in
bambu-hando key status              # where each key comes from, never its value
bambu-hando key remove 3dfp
```

A key is never taken as an argument, since it would end up in your shell history and in `ps`; `key set` refuses one. On a machine without a keyring (a headless box over SSH), set `FILAMENTPROFILES_API_KEY` or `SPOOLEASE_SECURITY_KEY` instead: each overrides its stored key. `key` exits `0` on success, `1` when the keyring can't be used (locked or not running) and `2` for invalid arguments or an empty key; ctrl+c at the prompt exits `130` and stores nothing.

## 3DFilamentProfiles

`bambu-hando 3dfp` reads your 3DFilamentProfiles account through its API, with the key from `bambu-hando key set 3dfp` (or `FILAMENTPROFILES_API_KEY`). The API allows a monthly number of calls (shown on its API access page), so bambu-hando spends as few as it can:

```bash
bambu-hando 3dfp usage              # calls left this month and when the quota resets; makes no call
bambu-hando 3dfp spools             # your spools: one call, or none while the last list is under an hour old
bambu-hando 3dfp spools --refresh   # fetch the whole list again anyway
bambu-hando 3dfp spools --json      # snake_case JSON: fetched_at, from_cache, changes_only, spools, quota
```

It needs Node 24 or later (the catalog uses Node's built-in SQLite).

- Every response says how many calls are left, and bambu-hando keeps that in `3dfp-quota.json` in its config directory; once the server has said none are left, it refuses further calls itself until the quota resets (00:00 UTC on the 1st). A call that gets no answer is counted as spent.
- The spool list is cached for an hour in its cache directory (the API asks integrations to poll no more than hourly), one cache per account: a fingerprint of the key tells them apart, never the key. After that hour, the call asks only for the spools changed (or deleted) since the last list and folds them in; once a day, or with `--refresh`, it fetches the whole list, which also picks up changes to the filaments themselves, such as a renamed color.
- Requests the API would refuse (out-of-range weights, too long a location) are refused before they're sent, since a refused request still costs a call.
- The key goes only to `https://3dfilamentprofiles.com`; no redirect is followed. `FILAMENTPROFILES_API_URL` can point at a server on this machine (for tests) and nowhere else.

### The local catalog

Everything bambu-hando reads about filaments goes into a local catalog (`3dfp-catalog.sqlite` in `~/.local/share/bambu-hando`, or Application Support on macOS), so it's never paid for twice. Copying the whole database through the API isn't possible within a month's quota (a full record is one call per filament, and there are tens of thousands), so the catalog fills cheapest first:

```bash
bambu-hando 3dfp filament 101                  # full record (temperatures, density, spool weight, flow, K, drying): one call the first time
bambu-hando 3dfp filament 101 --refresh-stale  # fetch it again if it's 30 days old or more
bambu-hando 3dfp search sunlu petg             # the catalog, no call
bambu-hando 3dfp search --online --brand sunlu # one call; the results are kept
bambu-hando 3dfp fill                          # from the 28th: spend what's left of the month, keeping 100 calls
bambu-hando 3dfp catalog                       # what it holds
```

- A full record is used as long as it's in the catalog. Past 30 days bambu-hando says how old it is, but only `--refresh-stale` fetches it again: community values such as flow ratio and K change slowly, and each check costs a call. Store prices aren't kept, since they change daily. If a refresh fails, the old copy is used with a warning. A filament merged into another is followed to the surviving one.
- `fill` uses the calls a month would otherwise lose: from the 28th (UTC; `--now` starts earlier) it fetches the full records of your spools' filaments, then lists their brands, then other brands it knows, then searches that turn up new brands, 50 filaments a call, down to the reserve (`--reserve`, default 100). A search stops at 20 pages, so a bigger brand is split by material. It picks up where it stopped, skips anything filled in the last 30 days, and pauses briefly between calls. Run it daily near the end of the month; from a scheduler it needs the user session (a systemd user timer, not cron), because the key is in the keyring.

### Syncing spools with SpoolEase

`bambu-hando 3dfp sync` links your SpoolEase spools to your 3DFilamentProfiles spools and keeps 3DFP's weights current. It prints what it would do and asks before writing anything:

```bash
bambu-hando 3dfp sync --dry-run              # the plan; changes nothing
bambu-hando 3dfp sync                        # the plan, then "Apply? [y/N]"
bambu-hando 3dfp sync --yes                  # apply without asking (scripts, timers)
bambu-hando 3dfp sync --link 3=ABC123        # pair SpoolEase spool #3 with 3DFP spool ABC123
bambu-hando 3dfp sync --add 1=10512          # add SpoolEase spool #1 to 3DFP as filament 10512
bambu-hando 3dfp sync --unlink 3             # forget #3's link
```

- **Links** live in `3dfp-links.json` in the config directory (one set per 3DFP account and SpoolEase console), the source of truth. A SpoolEase spool and a 3DFP spool with the same brand, material and color are linked by themselves when no other spool fits either of them (a SpoolEase color with extra words, such as "2.0 Vivid Yellow" for "Vivid Yellow", fits only when the color codes agree too, so "Black" never fits "Matte Black"); otherwise the plan lists the candidates for `--link`. A linked spool's SpoolEase tag UID is also written to its 3DFP spool (`bambu_tag_id`), so the links could be rebuilt from 3DFP.
- **Weights**: the link file remembers the weights both sides last agreed on. On a new link, SpoolEase's scale wins. After that, the side that changed since then wins; when both changed, the lower weight wins, since filament only gets used up. Differences under 5 g are ignored. 3DFP gets SpoolEase's weight; SpoolEase's own weight can only be set by its scale (its API doesn't take one), so when 3DFP's weight should win, the plan says to weigh the spool.
- **SpoolEase IDs on 3DFP**: each linked 3DFP spool gets `spoolease:<id>` in its external ID, so links lost with the link file come back: a 3DFP spool naming a SpoolEase spool links to it again when brand and material agree, even if a color was renamed. Unlinking clears it. An external ID another app set is never touched.
- **New 3DFP spools**: a SpoolEase spool with no 3DFP spool is offered as a new one when exactly one filament in the local catalog fits it; with none or several, the plan says how to find it (`3dfp search --online`) and pick one (`--add`). It's created at SpoolEase's weight, with its tag and SpoolEase ID, in one call.
- **Calls**: the weights and tags for linked spools go up 50 spools to a call, so a sync costs one call per 50 changed spools plus one per new spool. One spool's failed update doesn't hold back the others.
- **Cost**: one call for the spool list (none while the last one is under an hour old), one per weight or tag sent, two per new spool (one without a tag). It checks the quota covers the whole plan before sending anything.
- **3DFP-only spools** are listed with the command that brings them in (below).
- Not done: copying 3DFP's location or notes to SpoolEase (an edit there replaces the whole record, pressure-advance values included). Unlinking leaves the tag on the 3DFP spool.

### Bringing 3DFP spools into BambuStudio and SpoolEase

`bambu-hando 3dfp import` takes spools you already keep on 3DFilamentProfiles and sets them up on the other side: a BambuStudio preset per printer and SpoolEase's custom-filament row for each filament, one SpoolEase spool for each 3DFP spool, and a link between them (with the SpoolEase ID written to 3DFP). Like `sync`, it shows what it would write and asks first.

```bash
bambu-hando 3dfp import izDGMo7fU --dry-run          # what it would write; changes nothing
bambu-hando 3dfp import izDGMo7fU GkUIKRacF          # the plan, then "Import? [y/N]"
bambu-hando 3dfp import izDGMo7fU --printer-preset "Bambu Lab X1 Carbon 0.6 nozzle" --yes
```

- The presets come from the filament's 3DFP record: its temperatures (mid-range, as 3DFP's own generated profiles), bed temperature, flow ratio and max volumetric speed, with the spool's own calibration first when it has some. The record costs one call the first time and is kept in the catalog; a calibrated spool costs one more.
- It refuses, and says what to do instead, for a spool that's already linked, a Bambu Lab filament (BambuStudio ships its presets), and a filament an unlinked SpoolEase spool already is (link that one with `3dfp sync --link`).
- SpoolEase hasn't weighed the new spools yet: weigh them, and `3dfp sync` keeps the weights in step from then on.
- The TUI does the same from Add's Find page (`Your 3DFilamentProfiles spools`, also in the `ctrl+k` palette). Its list reads only the hour-old cached spool list and the local catalog, so moving through it costs no calls; records and calibrations are read when you continue to Review.

`3dfp` exits `0` on success, `1` when the API or network fails (for `sync`: when any write failed), and `2` for invalid arguments, a missing or rejected key, lapsed API access or a used-up quota.

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
