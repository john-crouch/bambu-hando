// ABOUTME: End-to-end tests for `bambu-hando key set` in the built binary: hidden prompt in a real PTY, and piped stdin.
// ABOUTME: Uses a private gnome-keyring, and checks the typed key is never echoed to the terminal.

import { execFile, spawn as spawnProcess } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { type IPty, spawn } from "node-pty";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { removeSecret, SECRETS, storedSecret } from "../src/secrets.js";
import { installBambuStudio, installSpoolEaseConfig } from "./bambuStudioSetup.js";
import { type PrivateKeyring, privateKeyringSupported, startPrivateKeyring } from "./keyring.js";
import { SOURCE_FIXTURE } from "./parity.js";
import { startSpoolEaseServer, TEST_SECURITY_KEY } from "./spooleaseServer.js";

const BIN = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
const TDFP = SECRETS["3dfp"];
const KEY = "3dfp_fake_key_for_tests";
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

describe.skipIf(!privateKeyringSupported)("bambu-hando key set (binary)", () => {
  let keyring: PrivateKeyring;
  let env: Record<string, string>;

  beforeAll(async () => {
    keyring = await startPrivateKeyring();
  });

  afterAll(async () => {
    await keyring.close();
  });

  beforeEach(() => {
    env = {
      PATH: process.env.PATH ?? "",
      TERM: "xterm-256color",
      HOME: process.env.TMPDIR ?? "/tmp",
      ...keyring.env,
    };
    for (const [name, value] of Object.entries(keyring.env)) vi.stubEnv(name, value);
  });

  afterEach(async () => {
    await removeSecret(TDFP);
    vi.unstubAllEnvs();
  });

  async function prompted(): Promise<{ pty: IPty; output: () => string; exited: Promise<number> }> {
    const pty = spawn(process.execPath, [BIN, "key", "set", "3dfp"], {
      name: "xterm-256color",
      cols: 100,
      rows: 10,
      env,
    });
    let raw = "";
    pty.onData((data) => (raw += data));
    const exited = new Promise<number>((resolve) =>
      pty.onExit(({ exitCode }) => resolve(exitCode)),
    );
    await until(() => raw.includes("3DFilamentProfiles API key (input hidden): "), "the prompt");
    // node-pty's UnixTerminal has ptsName at runtime, but its typings leave it out.
    await until(() => rawModeOn((pty as unknown as { ptsName: string }).ptsName), "raw mode");
    return { pty, output: () => raw, exited };
  }

  it("reads the key from a hidden prompt and never echoes it", async () => {
    const { pty, output, exited } = await prompted();
    for (const char of `${KEY}\r`) pty.write(char);
    expect(await exited).toBe(0);
    expect(output()).toContain("Stored the 3DFilamentProfiles API key");
    expect(output()).not.toContain("fake_key");
    expect(await storedSecret(TDFP)).toBe(KEY);
  });

  it("stores nothing and exits 130 on ctrl+c", async () => {
    const { pty, output, exited } = await prompted();
    pty.write("abc");
    pty.write("\u0003");
    expect(await exited).toBe(130);
    expect(output()).toContain("Cancelled");
    expect(await storedSecret(TDFP)).toBeNull();
  });

  it("stores a key piped to stdin", async () => {
    const child = spawnProcess(process.execPath, [BIN, "key", "set", "3dfp"], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.stdin.end(`${KEY}\n`);
    const code = await new Promise<number | null>((resolve) => child.on("exit", resolve));
    expect(code).toBe(0);
    expect(out).toBe(
      "Stored the 3DFilamentProfiles API key in the system keyring (Secret Service).\n",
    );
    expect(await storedSecret(TDFP)).toBe(KEY);
  });
});

describe("bambu-hando key without a reachable keyring (binary)", () => {
  // A fresh process per run: the keyring module keeps its first D-Bus connection for the process's life.
  const noKeyring = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.TMPDIR ?? "/tmp",
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/nonexistent/bus",
  };

  function cli(
    args: string[],
    env: Record<string, string>,
    stdin = "",
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const child = execFile(process.execPath, [BIN, ...args], { env }, (err, stdout, stderr) =>
        resolve({ code: err ? Number(err.code) : 0, stdout, stderr }),
      );
      child.stdin?.end(stdin);
    });
  }

  it.skipIf(process.platform !== "linux")(
    "exits 1 and points at the environment variable",
    async () => {
      for (const args of [
        ["key", "set", "3dfp"],
        ["key", "status"],
        ["key", "remove", "3dfp"],
      ]) {
        const { code, stdout, stderr } = await cli(args, noKeyring, KEY);
        expect(code).toBe(1);
        expect(stderr).toContain("set FILAMENTPROFILES_API_KEY instead");
        expect(stdout + stderr).not.toContain("fake_key");
      }
    },
  );

  it.skipIf(process.platform !== "linux")(
    "reports a key from the environment even when the keyring can't be read",
    async () => {
      const { code, stdout } = await cli(["key", "status", "3dfp"], {
        ...noKeyring,
        [TDFP.env]: KEY,
      });
      expect(code).toBe(0);
      expect(stdout).toMatch(
        /^3dfp {2}3DFilamentProfiles API key: from FILAMENTPROFILES_API_KEY \(can't check the system keyring \(Secret Service\)\)\n$/,
      );
      expect(stdout).not.toContain("fake_key");
    },
  );

  it.skipIf(process.platform !== "linux")(
    "falls back to BambuStudio's console key when the keyring can't be read",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "bh-nokeyring-"));
      await installBambuStudio(home);
      await installSpoolEaseConfig(home, { address: "127.0.0.1", security_key: TEST_SECURITY_KEY });
      const server = await startSpoolEaseServer();
      try {
        const { code, stdout, stderr } = await cli(
          ["--source", SOURCE_FIXTURE, "--dry-run", "--spoolease-port", String(server.port)],
          { ...noKeyring, HOME: home },
        );
        expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
        expect(server.requests[0]?.path).toBe("/api/test-key");
        expect(stdout).not.toContain(TEST_SECURITY_KEY);
      } finally {
        await server.close();
      }
    },
  );
});
