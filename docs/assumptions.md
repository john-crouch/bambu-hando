# Assumptions and Inferred Behavior

This project intentionally separates documented facts from inferred implementation details.

## Documented facts used

- SpoolEase exposes encrypted API endpoints including:
  - POST /api/test-key
  - POST /api/filaments-config
  - POST /api/spools/add-edit
- SpoolEase uses AES-256-GCM payload encryption with PBKDF2-HMAC-SHA256 key derivation and no-pad base64 nonce+ciphertext format.
- BambuStudio stores user presets under user-specific directories in config paths for Linux and macOS.
- BambuStudio user filament presets are JSON-based in current Bambu codebase.
- BambuStudio (`Preset.cpp` `load_presets`) names a user preset after its file, skips presets without a parseable `version`, reads `filament_id` from presets that inherit nothing, loads `filament/base/` before `filament/`, and treats the `.info` sidecar as optional. A local preset without a `setting_id` is uploaded by cloud sync, never removed (`PresetBundle::remove_users_preset`).
- Its "Create filament" dialog (`CreatePresetsDialog.cpp`, `clone_presets_for_filament`) clones a fully resolved system preset per printer, names it `<vendor> <type> <serial> @<printer>`, sets `filament_vendor`, `filament_type`, `compatible_printers`, `filament_settings_id` and `filament_id`, clears `inherits`, and saves it under `filament/base/`.
- `BambuStudio.conf` is JSON; `app.preset_folder` is the folder in use (the user ID when logged in) and `presets.machine` the selected printer.
- The SpoolEase build of BambuStudio (`src/spoolease/SpoolEaseConfig.cpp`) saves its console settings as JSON in `<config>/spoolease/config.json`: `console.address` and `console.security_key` (plus an API token and CA cert, which bambu-hando never reads). It strips an `http(s)://` prefix and any path from the address (`normalized_address`) and talks HTTPS to it.

- SpoolmanDB publishes its compiled database as `filaments.json` and `materials.json` on GitHub Pages (MIT license); each entry is one weight × diameter × color variant.
- SpoolEase's spool add/edit DTO takes `core_weight` and `label_weight` as `i32`, and treats 0 as "unknown" (`web_app.rs`).
- Since SpoolEase 0.7 (`0.7` branch, `web_app.rs` `AddSpoolDTO`), add/edit also requires `assigned_location`, `actual_location` (strings, empty for a new spool) and `spools_count` (`i32`, 1 for one spool); a missing field is a 400. Older consoles ignore these fields: the DTO doesn't deny unknown fields.
- SpoolEase signals most write failures in the body, not the status: `handle_web_app_post` always answers 200, so a failed spool add is a plain-text (unencrypted) message, and a refused custom-filaments CSV is an encrypted `{"error_text": ...}`. Only unparseable requests get 4xx. A successful add returns the new spool's `id`.

## Inferred details (best effort)

- Inherits chains are merged child-over-parent. BambuStudio additionally lets a child's `nil` entry inherit the parent's value in multi-extruder-variant arrays; among Generic presets this only occurs in three H2-series TPU presets.
- The Generic template for a material is the shortest-named Generic system preset whose `filament_type` matches the material, else its base (text before the first non-alphanumeric character).
- SpoolmanDB product names are what the manufacturer calls the color, so they double as the spool color name; SpoolmanDB has no separate color-name field in its compiled output.
- SpoolmanDB's single `extruder_temp` is used as both ends of the nozzle range. Its per-material `extruder_temp` is a general default, not tuned for any one product.
- SpoolEase spool creation uses a blank tag_id/id path to create inventory entries, inferred from web-app route behavior.

## Practical fallback if preset parsing differs in your fork

1. Create one custom filament manually in your BambuStudio fork.
2. Compare its generated JSON with the tool output.
3. Update field mapping in src/bambuStudio.ts to match your fork exactly.

## Data safety notes

- Always run with --dry-run first.
- Keep backups of BambuStudio user preset directories.
- Validate on a small profile sample before bulk import.
