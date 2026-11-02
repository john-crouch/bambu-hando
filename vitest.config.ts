// ABOUTME: Vitest configuration for bambu-hando.
// ABOUTME: The global setup gives each run its own TMPDIR and removes it afterwards.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["test/globalSetup.ts"],
  },
});
