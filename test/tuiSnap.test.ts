// ABOUTME: Tests the tui-snap dev script, which drives the built TUI in a real terminal and prints its screens.
// ABOUTME: Runs it against a temporary HOME with the fixture source, as a developer would against their own setup.

import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installBambuStudio } from "./bambuStudioSetup.js";
import { assertNoLoginKeyring } from "./keyringGuard.js";
import { SOURCE_FIXTURE } from "./parity.js";
import { type SpoolmanDbServer, startSpoolmanDbServer } from "./spoolmanDbServer.js";

const SCRIPT = fileURLToPath(new URL("../scripts/tui-snap.mjs", import.meta.url));

// Tests never reach the internet: Add loads SpoolmanDB from the stand-in server on its first visit.
let spoolmanDb: SpoolmanDbServer;

function snap(
  args: string[],
  home: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  // Keys in the environment, so the TUI never looks one up in a keyring (keyringGuard.ts).
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: home,
    SPOOLMANDB_URL: spoolmanDb.url,
    SPOOLEASE_SECURITY_KEY: "snap-test-key",
    FILAMENTPROFILES_API_KEY: "3dfp_snap_test_key",
  };
  // The script passes the arguments after "--" to bambu-hando tui, with the environment above.
  const dashes = args.indexOf("--");
  assertNoLoginKeyring(["tui", ...(dashes < 0 ? [] : args.slice(dashes + 1))], env);
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, ...args], { env }, (err, stdout, stderr) => {
      resolve({ code: err ? Number(err.code ?? 1) : 0, stdout, stderr });
    });
  });
}

describe("tui-snap", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "bambu-hando-snap-"));
    await installBambuStudio(home);
    spoolmanDb = await startSpoolmanDbServer();
  });

  afterEach(async () => {
    await spoolmanDb.close();
  });

  it("plays keys and prints each requested screen as the terminal shows it", async () => {
    const { code, stdout } = await snap(
      [
        "wait=SpoolEase skipped",
        "snap=add",
        "key=tab",
        "type=?",
        "wait=Help · Presets",
        "snap=help",
        "--",
        "--source",
        SOURCE_FIXTURE,
        "--skip-spoolease",
      ],
      home,
    );

    expect(code).toBe(0);
    expect(stdout).toContain("--- add ---");
    expect(stdout).toContain("bambu-hando");
    expect(stdout).toContain("--- help ---");
    expect(stdout).toContain("Everywhere");
    // Quits with ctrl+c when the steps run out.
    expect(stdout).toContain("exit: 130");
  });

  it("presses the shell's global keys: ctrl+k opens the palette, shift+tab goes back a tab", async () => {
    const { code, stdout } = await snap(
      [
        "wait=SpoolEase skipped",
        "key=ctrl+k",
        "wait=Type to find a command",
        "snap=palette",
        "key=esc",
        "key=shift+tab",
        "type=?",
        "wait=Help · Spools",
        "--",
        "--source",
        SOURCE_FIXTURE,
        "--skip-spoolease",
      ],
      home,
    );

    expect(code).toBe(0);
    expect(stdout).toContain("--- palette ---");
  });

  it("shows the screen and exits 1 when the awaited text never appears", async () => {
    const { code, stdout } = await snap(
      [
        "--timeout",
        "2000",
        "wait=no such text",
        "--",
        "--source",
        SOURCE_FIXTURE,
        "--skip-spoolease",
      ],
      home,
    );

    expect(code).toBe(1);
    expect(stdout).toContain('timed out waiting for "no such text"');
    expect(stdout).toContain("SpoolEase skipped");
  });

  it("rejects an unknown step", async () => {
    const { code, stderr } = await snap(["bogus=1"], home);

    expect(code).toBe(2);
    expect(stderr).toContain('unknown step "bogus=1"');
  });
});
