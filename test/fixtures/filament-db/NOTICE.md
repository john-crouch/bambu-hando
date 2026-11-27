# filament-db export fixture

`catalog.json` is trimmed from a real `filament-db export --format json` (schema_version 2, built 2026-11-27):
lines 1383 (Polymaker ASA), 1384 (Polymaker Polylite ASA), 68 (3DO PETG) and 483 (Creality PETG), a few printer
presets and colors of each, and the 3DFilamentProfiles entries 16899 and 32336. Nothing in it was edited.

Each value names its source; their licenses, as the export states them:

- `polymaker_preset`: Polymaker3D/Polymaker-Preset, MIT
- `polymaker_legacy`: Polymaker's legacy profile bundles, none stated
- `ofd`: Open Filament Database, MIT
- `3dfp`: community data read through the 3DFilamentProfiles API, under its terms
- `bambustudio`: values of BambuStudio's own system profiles (AGPL-3.0), as in `../bambustudio`
