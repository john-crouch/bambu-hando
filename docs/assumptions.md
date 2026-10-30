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

- SpoolmanDB publishes its compiled database as `filaments.json` and `materials.json` on GitHub Pages (MIT license); each entry is one weight × diameter × color variant.
- SpoolEase's spool add/edit DTO takes `core_weight` and `label_weight` as `i32`, and treats 0 as "unknown" (`web_app.rs`).

## Inferred details (best effort)

- Exact minimal key-set required for BambuStudio to fully recognize generated filament presets may vary by version/fork.
- Generated filament preset JSON includes commonly used filament fields and metadata, but may need tuning if your custom BambuStudio fork enforces stricter schema.
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
