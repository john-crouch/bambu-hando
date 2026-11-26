// ABOUTME: Tests that the test run can't touch the real user's files: HOME and the XDG folders point into the run's temp dir.
// ABOUTME: A test that forgets to stub HOME then writes under the run's dir, never to ~/.config/bambu-hando.

import { homedir, userInfo } from "node:os";
import { describe, expect, it } from "vitest";

import { cacheDir, configDir, dataDir } from "../src/paths.js";

describe("test isolation", () => {
  it("keeps HOME and every bambu-hando folder away from the real home directory", () => {
    const real = userInfo().homedir;
    expect(homedir()).not.toBe(real);
    for (const dir of [configDir(), cacheDir(), dataDir()]) {
      expect(dir.startsWith(`${real}/`)).toBe(false);
      expect(dir).toContain("bh-run-");
    }
  });
});
