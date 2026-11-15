// ABOUTME: Vitest global setup: points TMPDIR at a fresh, short-named directory for this test run.
// ABOUTME: Every mkdtemp in tests (and in processes they spawn) lands there, and teardown removes it; the login keyring is out of reach.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default async function setup(): Promise<() => Promise<void>> {
  const runDir = await mkdtemp(join(tmpdir(), "bh-run-"));
  process.env.TMPDIR = runDir;
  // No test may reach the login keyring (it holds real keys); keyring tests start a private one.
  process.env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${join(runDir, "no-login-keyring")}`;
  return async () => {
    await rm(runDir, { recursive: true, force: true });
  };
}
