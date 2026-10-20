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

## Inferred details (best effort)

- Exact minimal key-set required for BambuStudio to fully recognize generated filament presets may vary by version/fork.
- Generated filament preset JSON includes commonly used filament fields and metadata, but may need tuning if your custom BambuStudio fork enforces stricter schema.
- SpoolEase spool creation uses a blank tag_id/id path to create inventory entries, inferred from web-app route behavior.

## Practical fallback if preset parsing differs in your fork

1. Create one custom filament manually in your BambuStudio fork.
2. Compare its generated JSON with the tool output.
3. Update field mapping in src/bambu_hando/bambu_studio.py to match your fork exactly.

## Data safety notes

- Always run with --dry-run first.
- Keep backups of BambuStudio user preset directories.
- Validate on a small profile sample before bulk import.
