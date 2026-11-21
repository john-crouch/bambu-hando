// ABOUTME: Vitest configuration for bambu-hando.
// ABOUTME: The global setup gives each run its own TMPDIR; the setup file keeps every test off the login keyring.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["test/globalSetup.ts"],
    setupFiles: ["test/setupKeyringGuard.ts"],
  },
});
