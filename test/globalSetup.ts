// ABOUTME: Vitest global setup: points TMPDIR at a fresh, short-named directory for this test run.
// ABOUTME: Every mkdtemp in tests (and in processes they spawn) lands there, and teardown removes it.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default async function setup(): Promise<() => Promise<void>> {
  const runDir = await mkdtemp(join(tmpdir(), "bh-run-"));
  process.env.TMPDIR = runDir;
  return async () => {
    await rm(runDir, { recursive: true, force: true });
  };
}
