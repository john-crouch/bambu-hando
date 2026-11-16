// ABOUTME: Tests the tui-snap dev script, which drives the built TUI in a real terminal and prints its screens.
// ABOUTME: Runs it against a temporary HOME with the fixture source, as a developer would against their own setup.

import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it } from "vitest";

import { SOURCE_FIXTURE } from "./parity.js";
import { installBambuStudio } from "./bambuStudioSetup.js";

const SCRIPT = fileURLToPath(new URL("../scripts/tui-snap.mjs", import.meta.url));

function snap(args: string[], home: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, ...args], { env: { PATH: process.env.PATH ?? "", HOME: home } }, (err, stdout, stderr) => {
      resolve({ code: err ? Number(err.code ?? 1) : 0, stdout, stderr });
    });
  });
}

describe("tui-snap", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "bambu-hando-snap-"));
    await installBambuStudio(home);
  });

  it("plays keys and prints each requested screen as the terminal shows it", async () => {
    const { code, stdout } = await snap(
      ["wait=ctrl+c quit", "snap=menu", "key=enter", "wait=[a] apply", "snap=plan", "--", "--source", SOURCE_FIXTURE, "--skip-spoolease"],
      home,
    );

    expect(code).toBe(0);
    expect(stdout).toContain("--- menu ---");
    expect(stdout).toContain("› Import source.json");
    expect(stdout).toContain("--- plan ---");
    expect(stdout).toContain("3 profiles from");
    // Quits with ctrl+c when the steps run out.
    expect(stdout).toContain("exit: 130");
  });

  it("shows the screen and exits 1 when the awaited text never appears", async () => {
    const { code, stdout } = await snap(["--timeout", "2000", "wait=no such text", "--", "--source", SOURCE_FIXTURE, "--skip-spoolease"], home);

    expect(code).toBe(1);
    expect(stdout).toContain('timed out waiting for "no such text"');
    expect(stdout).toContain("Add spools from SpoolmanDB");
  });

  it("rejects an unknown step", async () => {
    const { code, stderr } = await snap(["bogus=1"], home);

    expect(code).toBe(2);
    expect(stderr).toContain('unknown step "bogus=1"');
  });
});
