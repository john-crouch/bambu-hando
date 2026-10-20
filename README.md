# bambu-hando

Cross-platform filament profile handoff tool for BambuStudio and SpoolEase.

It automates three things:
- Load/download filament profile data from JSON source
- Create custom filament preset files for BambuStudio (Linux + macOS)
- Create matching custom filament records in SpoolEase, including RGBA color

## Why this exists

If you have many filaments and are relying on defaults, this tool reduces repetitive manual setup and keeps BambuStudio + SpoolEase in sync.

## Scope

- Supported OS: Linux, macOS
- Supported printer workflow: Bambu Lab with SpoolEase ecosystem
- Works with LAN-only + Developer mode workflows where SpoolEase integrations are available

## Install

```bash
python -m pip install -e .
```

## Input source format

Provide a JSON file or URL. Example:

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
    "slicer_filament_code": "PABC1234"
  }
]
```

## Run

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
- Produces JSON report output for auditability

## Limitations

See docs/assumptions.md for known inferred fields and constraints.
