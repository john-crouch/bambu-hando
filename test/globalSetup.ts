// ABOUTME: Vitest global setup: points TMPDIR, HOME and the XDG folders at a fresh, short-named directory for this run.
// ABOUTME: Every mkdtemp in tests (and in processes they spawn) lands there, and teardown removes it; the login keyring is out of reach.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default async function setup(): Promise<() => Promise<void>> {
  const runDir = await mkdtemp(join(tmpdir(), "bh-run-"));
  process.env.TMPDIR = runDir;
  // No test may write the real user's files (~/.config/bambu-hando/tui.json and the rest): a test that
  // forgets to stub HOME lands here instead. Tests that stub HOME still get their own.
  process.env.HOME = join(runDir, "home");
  for (const name of ["XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME"])
    delete process.env[name];
  // No test may reach the login keyring (it holds real keys); keyring tests start a private one.
  process.env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${join(runDir, "no-login-keyring")}`;
  return async () => {
    await rm(runDir, { recursive: true, force: true });
  };
}
