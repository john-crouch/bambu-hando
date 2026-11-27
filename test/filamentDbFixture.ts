// ABOUTME: Where the trimmed real filament-db export used by the tests lives.
// ABOUTME: Tests point FILAMENT_DB_EXPORT here, never at the real export in the user's data folder.

import { fileURLToPath } from "node:url";

export const FILAMENT_DB_FIXTURE = fileURLToPath(
  new URL("./fixtures/filament-db/catalog.json", import.meta.url),
);
