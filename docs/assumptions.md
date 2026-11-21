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
- Inferred from `Preset.cpp` (`PresetCollection`'s cloud sync and `get_user_presets`): a synced preset's `.info` holds its `setting_id` and `updated_time`. When syncing, BambuStudio keeps a local preset whose `updated_time` is newer than the cloud copy's and marks it `update` to upload, clears the mark when they are equal, and replaces the local file with a newer cloud copy. So giving a preset a filament ID (`presetIds.ts`) or editing it (`presetEdit.ts`) also moves its `.info` `updated_time` to now; editing the JSON alone would stay local and could be overwritten later. Not checked against a live account.
- Its "Create filament" dialog (`CreatePresetsDialog.cpp`, `clone_presets_for_filament`) clones a fully resolved system preset per printer, names it `<vendor> <type> <serial> @<printer>`, sets `filament_vendor`, `filament_type`, `compatible_printers`, `filament_settings_id` and `filament_id`, clears `inherits`, and saves it under `filament/base/`.
- `BambuStudio.conf` is JSON; `app.preset_folder` is the folder in use (the user ID when logged in) and `presets.machine` the selected printer.
- The SpoolEase build of BambuStudio (`src/spoolease/SpoolEaseConfig.cpp`) saves its console settings as JSON in `<config>/spoolease/config.json`: `console.address` and `console.security_key` (plus an API token and CA cert, which bambu-hando never reads). It strips an `http(s)://` prefix and any path from the address (`normalized_address`) and talks HTTPS to it.

- SpoolmanDB publishes its compiled database as `filaments.json` and `materials.json` on GitHub Pages (MIT license); each entry is one weight × diameter × color variant.
- SpoolEase's spool add/edit DTO takes `core_weight` and `label_weight` as `i32`, and treats 0 as "unknown" (`web_app.rs`).
- Since SpoolEase 0.7 (`0.7` branch, `web_app.rs` `AddSpoolDTO`), add/edit also requires `assigned_location`, `actual_location` (strings, empty for a new spool) and `spools_count` (`i32`, 1 for one spool); a missing field is a 400. Older consoles ignore these fields: the DTO doesn't deny unknown fields.
- SpoolEase 0.7 serves its built-in spool weight catalog as a plain-text file at `GET /spools-catalog` (`web_app.rs`; credited to Scuk's Printables catalog and OnlySpoolz), and the user's own "My Spools List" as encrypted `{"spools": ...}` at `GET /api/spools-config` (`user_cores`). Both are `name,grams` lines, sometimes two pairs per line; its spool form (inventory web app) parses them pair by pair and offers them in an "Empty Weight(g)" dropdown, never applying one by itself.
- When a spool whose core weight is 0 is weighed as new and full, and its label weight is known, SpoolEase sets the core weight to the measured weight minus the label weight (`view_model.rs` `set_spool_weight_async`). That is why "unspecified" (0) is a real choice.
- SpoolEase signals most write failures in the body, not the status: `handle_web_app_post` always answers 200, so a failed spool add is a plain-text (unencrypted) message, and a refused custom-filaments CSV is an encrypted `{"error_text": ...}`. Only unparseable requests get 4xx. A successful add returns the new spool's `id`.

- `GET /api/spools` is headerless CSV in `SpoolRecord` field order (`spool_record.rs`): `id`, `tag_id`, `material_type`, `material_subtype`, `color_name`, `color_code`, `note`, `brand`, `weight_advertised`, `weight_core`, `weight_new`, `weight_current`, `slicer_filament`, `added_time`, … `assigned_location`, `actual_location`. Spool IDs are short sequential numbers ("1", "2", …). `weight_current` (column 11) is what the spool last weighed, core included, and `consumed_since_weight` (column 17) the grams printed since, a little-endian f32 in base64 without padding, empty for 0 (`shared/src/utils.rs` `serialize_f32_base64`). The filament left is SpoolEase's `weight_left_spool` (`view_model.rs`): `weight_current` less `weight_core`, or less `weight_new - weight_advertised` without a core weight, less `consumed_since_weight`. A real console's record matched the column layout (25 fields, `weight_current` set); a non-zero `consumed_since_weight` hasn't been seen on one yet.
- SpoolEase's NFC tags carry a link built by `SpoolRecord::to_tag_descriptor_s1`: `https://tag.spoolease.io/S1/?TG=<tag>&ID=…&DE=…&DA=…&M=…&MS=…&CC=…&CN=…&B=…&WL=…&WE=…&WF=…&SC=…&SN=…&NN=…&NX=…&N=…`. Values are percent-encoded except ASCII letters, digits and `;` (which joins several colors), and any value equal to its default (empty, 0) is left out (`part_val`). The tag app at that address (`webtag`) shows a spool card from these parameters and needs none of the rest. Labels use this link without `TG` (a label has no NFC tag) and without `SN`, `NN`, `NX` and `N` (they only make the QR code denser).
- An edit through `POST /api/spools/add-edit` (a non-empty `id`) can't set a spool's weight: `store.rs` `edit_spool_from_web` (0.7) keeps the stored `weight_new` and `weight_current` ("can't change from web"), `consumed_since_*`, `added_time` and the origin fields, and takes everything else from the DTO, including `tag_id`, the locations, the note and `k_info` (`ext_has_k` becomes `k_info.is_some()`, so an edit without it drops the spool's pressure-advance values). Hence the spool sync never writes weights to SpoolEase, and doesn't edit SpoolEase spools at all.
- SpoolEase 0.7 has no QR scanning, and its inventory web app reads only `#sk=` (the security key) from its URL, so no link can open one spool on the console.

- Seen in real user presets: values are lists of strings with one entry per extruder variant, listed in `filament_extruder_variant` (one or two here, e.g. `["Direct Drive Standard", "Direct Drive High Flow"]`; BambuStudio's default when absent is `["Direct Drive Standard"]`, `PrintConfig.cpp`), a few keys are plain strings (`filament_notes`, `inherits`), and `"nil"` in a list means the printer's own value (retraction). The keys BambuStudio keeps per variant are `filament_options_with_variant` (`PrintConfig.cpp`: nozzle temperatures, flow ratio, max volumetric speed, retraction and more).
- Which variant BambuStudio prints with: `BambuStudio.conf`'s `nozzle_volume_types` section maps a printer preset name to its nozzle type (`"Standard"`, `"High Flow"`, …; `AppConfig::get_nozzle_volume_types_from_config`), and the variant is `"<extruder_type> <nozzle type>"` (`get_extruder_variant_string`), falling back to the preset's first variant when it has none of that name (`get_config_index_base`). Inferred: bambu-hando doesn't read the machine's `extruder_type`; it takes the variant ending in the nozzle type, Direct Drive first, which is the same whenever a preset lists one extruder type. Missing or unknown types count as Standard, and a value listing several (multi-extruder) uses the first.
- The editor edits that variant, plus every variant that held the same value (per preset file, so a variant set apart keeps its own, `"nil"` included); `n` makes a field's edit go to every variant (`"nil"` kept, as `buildPreset`'s `everyVariant` keeps it, unless the list holds only `"nil"`). One-variant presets get every-variant edits as before. A field confirmed unchanged records no edit.
- Nozzle size: each printer preset (nozzle size) has its own file, and a filament's files share its `filament_id`. Max volumetric speed, pressure advance and retraction are tuned per nozzle size, so the review saves those (and raw settings) into the edited preset only unless the others are ticked; material settings (temperatures, bed, flow ratio, fans, color, density, cost, notes) go into every file of the filament by default. Inferred from how people tune presets, not from BambuStudio, which treats every file alike.

- The 3DFilamentProfiles v1 API (its own API documentation, read 2026-11-15; kept off the repo) lives at `https://3dfilamentprofiles.com/api/v1` and takes the account's one key, which starts with `3dfp_`, as `Authorization: Bearer` (or `x-api-key`; bambu-hando sends only the bearer form and follows no redirect). Every authenticated response carries `X-RateLimit-Limit` and `X-RateLimit-Remaining`; the monthly quota resets at 00:00 UTC on the 1st, every request with a valid key counts (400, 404 and 422 included) except those rejected with 401 or 402, and an exhausted quota answers `429 rate_limited`. Responses are `Cache-Control: private, no-store` with no ETags, and integrations should poll no more than hourly, hence the hour-long spool cache. Errors are `{ "error": { "code", "message" } }`.
- In that API, `GET /my/spools` returns every spool in one unpaginated call (the My Spools export shape: `brand`, `spool_url`, `empty_spool_weight`, no Bambu IDs); `GET /my/spools/{short_code}` is the only read with `bambu_spool_id` and `bambu_tag_id`. `PATCH /my/spools/{short_code}` takes at most one of `remaining_grams` (0 to 10000), `used_grams`, `used_mm`, plus `location` (a saved location's name; null clears it), `bambu_spool_id` and `bambu_tag_id` (setting a tag ID clears it from any other spool). `POST /my/spools` with `if_not_owned` creates nothing when a spool of the filament with grams left exists. `GET /filaments` pages are 1 to 20 with 1 to 50 results; a merged filament's `GET /filaments/{id}` returns the surviving id. The client checks these bounds itself, since a refused request still costs a call.

- `POST /my/spools` takes `filament_id`, `if_not_owned`, `remaining_grams` and `notes`, not the Bambu IDs, so a new spool's tag needs a second call (`PATCH`).
- Verified live (2026-11-15): `PATCH /my/spools/{short_code}` stored a 14-hex-character `bambu_tag_id` (the length of a 7-byte NFC tag UID such as SpoolEase's, though the docs name only 8- and 16-character forms) and returned it unchanged, and `null` cleared it; the spool's weight and location were untouched.
- Inferred from those bounds: a filter returns at most 1,000 filaments (20 pages of 50), so the catalog fill splits a brand that fills all 20 pages by material, and finds brands through the unfiltered list and per-material lists, which also stop at 1,000. Brands only reachable past those caps are found only when a spool, search or record names them. The API has no "changed since" filter, so the catalog can't tell which records changed without fetching them.

## Verified on hardware

- The ID link holds end to end (SpoolEase 0.7, a Bambu printer with an AMS): a loaded spool's `slicer_filament` reaches the AMS tray's `tray_info_idx` together with the material, color and nozzle range from its custom-filaments CSV row, BambuStudio records it in `BambuStudio.conf` `ams_filament_ids`, and its AMS sync shows the user preset whose `filament_id` matches.

## Inferred details (best effort)

- A multi-color spool's `color_code` column holds its RGBA codes joined with `;`, as in its tag links; no real multi-color record has been checked.
- The sync check (`syncCheck.ts`) treats spool codes starting with `GF` as Bambu Lab's: every `filament_id` in the BBL bundle starts with it (86 of 86 in an installed bundle), and SpoolEase reads a Bambu Lab spool's code from its tag, so those need no custom filament. Real user presets made outside BambuStudio's Create filament were seen with `filament_id: "null"`; the check reports those as presets without an ID.
- More spools of a filament (`spoolCopies.ts`) send only the first of those codes as the copy's `rgba`: `AddSpoolDTO` takes one `rgba` string, and how SpoolEase would read a `;`-joined one is unverified.

- Inherits chains are merged child-over-parent. BambuStudio additionally lets a child's `nil` entry inherit the parent's value in multi-extruder-variant arrays; among Generic presets this only occurs in three H2-series TPU presets.
- The Generic template for a material is the shortest-named Generic system preset whose `filament_type` matches the material, else its base (text before the first non-alphanumeric character).
- SpoolmanDB product names are what the manufacturer calls the color, so they double as the spool color name; SpoolmanDB has no separate color-name field in its compiled output.
- Our choice, not documented anywhere: SpoolEase keeps one nozzle range per filament code while BambuStudio keeps one per preset (one per printer), so a sync sends SpoolEase the first kept preset's range when the run keeps any, else the source's with the plan's edits. A preset tuned by hand or with the preset editor therefore wins over the source on a re-sync.
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
