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
- Inferred from `Preset.cpp` (`PresetCollection`'s cloud sync and `get_user_presets`): a synced preset's `.info` holds its `setting_id` and `updated_time`. When syncing, BambuStudio keeps a local preset whose `updated_time` is newer than the cloud copy's and marks it `update` to upload, clears the mark when they are equal, and replaces the local file with a newer cloud copy. So giving a preset a filament ID (`presetIds.ts`) also moves its `.info` `updated_time` to now; editing the JSON alone would stay local and could be overwritten later. Not checked against a live account.
- Its "Create filament" dialog (`CreatePresetsDialog.cpp`, `clone_presets_for_filament`) clones a fully resolved system preset per printer, names it `<vendor> <type> <serial> @<printer>`, sets `filament_vendor`, `filament_type`, `compatible_printers`, `filament_settings_id` and `filament_id`, clears `inherits`, and saves it under `filament/base/`.
- `BambuStudio.conf` is JSON; `app.preset_folder` is the folder in use (the user ID when logged in) and `presets.machine` the selected printer.
- The SpoolEase build of BambuStudio (`src/spoolease/SpoolEaseConfig.cpp`) saves its console settings as JSON in `<config>/spoolease/config.json`: `console.address` and `console.security_key` (plus an API token and CA cert, which bambu-hando never reads). It strips an `http(s)://` prefix and any path from the address (`normalized_address`) and talks HTTPS to it.

- SpoolmanDB publishes its compiled database as `filaments.json` and `materials.json` on GitHub Pages (MIT license); each entry is one weight × diameter × color variant.
- SpoolEase's spool add/edit DTO takes `core_weight` and `label_weight` as `i32`, and treats 0 as "unknown" (`web_app.rs`).
- Since SpoolEase 0.7 (`0.7` branch, `web_app.rs` `AddSpoolDTO`), add/edit also requires `assigned_location`, `actual_location` (strings, empty for a new spool) and `spools_count` (`i32`, 1 for one spool); a missing field is a 400. Older consoles ignore these fields: the DTO doesn't deny unknown fields.
- SpoolEase 0.7 serves its built-in spool weight catalog as a plain-text file at `GET /spools-catalog` (`web_app.rs`; credited to Scuk's Printables catalog and OnlySpoolz), and the user's own "My Spools List" as encrypted `{"spools": ...}` at `GET /api/spools-config` (`user_cores`). Both are `name,grams` lines, sometimes two pairs per line; its spool form (inventory web app) parses them pair by pair and offers them in an "Empty Weight(g)" dropdown, never applying one by itself.
- When a spool whose core weight is 0 is weighed as new and full, and its label weight is known, SpoolEase sets the core weight to the measured weight minus the label weight (`view_model.rs` `set_spool_weight_async`). That is why "unspecified" (0) is a real choice.
- SpoolEase signals most write failures in the body, not the status: `handle_web_app_post` always answers 200, so a failed spool add is a plain-text (unencrypted) message, and a refused custom-filaments CSV is an encrypted `{"error_text": ...}`. Only unparseable requests get 4xx. A successful add returns the new spool's `id`.

- `GET /api/spools` is headerless CSV in `SpoolRecord` field order (`spool_record.rs`): `id`, `tag_id`, `material_type`, `material_subtype`, `color_name`, `color_code`, `note`, `brand`, `weight_advertised`, `weight_core`, `weight_new`, `weight_current`, `slicer_filament`, `added_time`, … `assigned_location`, `actual_location`. Spool IDs are short sequential numbers ("1", "2", …).
- SpoolEase's NFC tags carry a link built by `SpoolRecord::to_tag_descriptor_s1`: `https://tag.spoolease.io/S1/?TG=<tag>&ID=…&DE=…&DA=…&M=…&MS=…&CC=…&CN=…&B=…&WL=…&WE=…&WF=…&SC=…&SN=…&NN=…&NX=…&N=…`. Values are percent-encoded except ASCII letters, digits and `;` (which joins several colors), and any value equal to its default (empty, 0) is left out (`part_val`). The tag app at that address (`webtag`) shows a spool card from these parameters and needs none of the rest. Labels use this link without `TG` (a label has no NFC tag) and without `SN`, `NN`, `NX` and `N` (they only make the QR code denser).
- SpoolEase 0.7 has no QR scanning, and its inventory web app reads only `#sk=` (the security key) from its URL, so no link can open one spool on the console.

## Verified on hardware

- The ID link holds end to end (SpoolEase 0.7, a Bambu printer with an AMS): a loaded spool's `slicer_filament` reaches the AMS tray's `tray_info_idx` together with the material, color and nozzle range from its custom-filaments CSV row, BambuStudio records it in `BambuStudio.conf` `ams_filament_ids`, and its AMS sync shows the user preset whose `filament_id` matches.

## Inferred details (best effort)

- A multi-color spool's `color_code` column holds its RGBA codes joined with `;`, as in its tag links; no real multi-color record has been checked.
- The sync check (`syncCheck.ts`) treats spool codes starting with `GF` as Bambu Lab's: every `filament_id` in the BBL bundle starts with it (86 of 86 in an installed bundle), and SpoolEase reads a Bambu Lab spool's code from its tag, so those need no custom filament. Real user presets made outside BambuStudio's Create filament were seen with `filament_id: "null"`; the check reports those as presets without an ID.
- More spools of a filament (`spoolCopies.ts`) send only the first of those codes as the copy's `rgba`: `AddSpoolDTO` takes one `rgba` string, and how SpoolEase would read a `;`-joined one is unverified.

- Inherits chains are merged child-over-parent. BambuStudio additionally lets a child's `nil` entry inherit the parent's value in multi-extruder-variant arrays; among Generic presets this only occurs in three H2-series TPU presets.
- The Generic template for a material is the shortest-named Generic system preset whose `filament_type` matches the material, else its base (text before the first non-alphanumeric character).
- SpoolmanDB product names are what the manufacturer calls the color, so they double as the spool color name; SpoolmanDB has no separate color-name field in its compiled output.
- SpoolmanDB's single `extruder_temp` is used as both ends of the nozzle range. Its per-material `extruder_temp` is a general default, not tuned for any one product.
- Catalog rows belong to a brand when their name, compared by letters and digits only, starts with the brand ("PolyMaker - Plastic" for Polymaker). Rows name their spool size only when it isn't 1 kg ("Sunlu 250g - Plastic - 55g"), so a row without one is taken as a 1 kg spool.
- SpoolEase spool creation uses a blank tag_id/id path to create inventory entries, inferred from web-app route behavior.

## Practical fallback if preset parsing differs in your fork

1. Create one custom filament manually in your BambuStudio fork.
2. Compare its generated JSON with the tool output.
3. Update field mapping in src/bambuStudio.ts to match your fork exactly.

## Data safety notes

- Always run with --dry-run first.
- Keep backups of BambuStudio user preset directories.
- Validate on a small profile sample before bulk import.
