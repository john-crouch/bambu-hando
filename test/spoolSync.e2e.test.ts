// ABOUTME: End-to-end tests for `bambu-hando 3dfp sync` in the built binary, against SpoolEase and 3DFilamentProfiles stand-ins.
// ABOUTME: Answers its question in a real PTY, and checks a run without a terminal writes nothing.

import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { spawn } from "node-pty";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { configDir } from "../src/paths.js";
import {
  type FilamentProfilesServer,
  serverSpool,
  startFilamentProfilesServer,
  TEST_API_KEY,
} from "./filamentProfilesServer.js";
import { assertNoLoginKeyring } from "./keyringGuard.js";
import {
  type SpoolEaseServer,
  startSpoolEaseServer,
  TEST_SECURITY_KEY,
} from "./spooleaseServer.js";

const BIN = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
const WAIT_MS = 8_000;

function rawModeOn(ptsName: string): Promise<boolean> {
  const flag = process.platform === "darwin" ? "-f" : "-F";
  return new Promise((resolve) =>
    execFile("stty", [flag, ptsName, "-a"], (err, stdout) =>
      resolve(!err && /(^|\s)-icanon(\s|$)/.test(stdout)),
    ),
  );
}

async function until(check: () => boolean | Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + WAIT_MS;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("bambu-hando 3dfp sync (binary)", () => {
  let tdfp: FilamentProfilesServer;
  let spoolease: SpoolEaseServer;
  let home: string;
  let env: Record<string, string>;

  beforeEach(async () => {
    tdfp = await startFilamentProfilesServer();
    tdfp.spools = [serverSpool({ remaining_grams: 1000 })];
    spoolease = await startSpoolEaseServer();
    spoolease.spools = [
      {
        id: "1",
        tag_id: "04A1B2C3D4E5F6",
        material_type: "PETG",
        color_name: "2.0 Vivid Yellow",
        color_code: "FFD700FF",
        brand: "Sunlu",
        weight_advertised: "1000",
        weight_core: "189",
        weight_current: "753",
      },
    ];
    home = await mkdtemp(join(tmpdir(), "bh-sync-e2e-"));
    env = {
      PATH: process.env.PATH ?? "",
      TERM: "xterm-256color",
      HOME: home,
      FILAMENTPROFILES_API_KEY: TEST_API_KEY,
      FILAMENTPROFILES_API_URL: tdfp.url,
      SPOOLEASE_HOST: "127.0.0.1",
      SPOOLEASE_SECURITY_KEY: TEST_SECURITY_KEY,
    };
  });

  afterEach(async () => {
    await tdfp.close();
    await spoolease.close();
  });

  const args = () => [BIN, "3dfp", "sync", "--spoolease-port", String(spoolease.port)];
  const writes = () => tdfp.requests.filter((r) => r.method !== "GET");

  async function asked(): Promise<{
    type: (text: string) => void;
    output: () => string;
    exited: Promise<number>;
  }> {
    assertNoLoginKeyring(args().slice(1), env);
    const pty = spawn(process.execPath, args(), {
      name: "xterm-256color",
      cols: 160,
      rows: 20,
      env,
    });
    let raw = "";
    pty.onData((data) => (raw += data));
    const exited = new Promise<number>((resolve) =>
      pty.onExit(({ exitCode }) => resolve(exitCode)),
    );
    await until(() => raw.includes("Apply? [y/N] "), "the question");
    // node-pty's UnixTerminal has ptsName at runtime, but its typings leave it out.
    await until(() => rawModeOn((pty as unknown as { ptsName: string }).ptsName), "raw mode");
    return {
      type: (text) => {
        for (const char of text) pty.write(char);
      },
      output: () => raw,
      exited,
    };
  }

  it("applies the plan when the answer is yes", async () => {
    const { type, output, exited } = await asked();
    expect(output()).toContain(
      "Link      #1 Sunlu PETG 2.0 Vivid Yellow ↔ ABC123 Sunlu PETG Vivid Yellow (same brand, material and color)",
    );
    type("y\r");
    expect(await exited).toBe(0);
    expect(output()).toContain("Done: 1 change applied (1 API call; 998 of 1000 left this month).");
    expect(writes().map((r) => r.body)).toEqual([
      [{ short_code: "ABC123", remaining_grams: 564, bambu_tag_id: "04A1B2C3D4E5F6" }],
    ]);
    const saved = await readFile(
      join(configDir(process.platform, home, {}), "3dfp-links.json"),
      "utf-8",
    );
    expect(JSON.parse(saved).books[0].links).toMatchObject([{ spoolease: "1", tdfp: "ABC123" }]);
    expect(output() + saved).not.toContain(TEST_API_KEY);
    expect(output() + saved).not.toContain(TEST_SECURITY_KEY);
  });

  it("writes nothing on ctrl+c", async () => {
    const { type, output, exited } = await asked();
    type("\u0003");
    expect(await exited).toBe(0);
    expect(output()).toContain("Nothing changed.");
    expect(writes()).toEqual([]);
  });

  it("writes nothing when there's no terminal to ask on", async () => {
    const result = await new Promise<{ code: number; stdout: string }>((resolve) => {
      assertNoLoginKeyring(args().slice(1), env);
      execFile(process.execPath, args(), { env }, (err, stdout) =>
        resolve({ code: err ? Number(err.code) : 0, stdout }),
      );
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(
      /Not applied: pass --yes, or run this in a terminal to be asked\.\n$/,
    );
    expect(writes()).toEqual([]);
  });
});
