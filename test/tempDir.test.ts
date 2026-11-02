// ABOUTME: Tests that test temp files land in the per-run directory from test/globalSetup.ts.
// ABOUTME: That directory is removed when the run ends, so tests never leak dirs into the system tmp.

import { tmpdir } from "node:os";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";

describe("test temp dir", () => {
  it("is the per-run directory that the run removes", () => {
    expect(basename(tmpdir())).toMatch(/^bh-run-/);
  });
});
