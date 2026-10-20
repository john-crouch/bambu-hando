// ABOUTME: End-to-end TUI tests that run the built binary inside a real pseudo-terminal.
// ABOUTME: Sends real keystrokes via node-pty and asserts on rendered frames, files, and exit codes.

import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { spawn, type IPty } from "node-pty";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SOURCE_FIXTURE } from "./parity.js";
import { startSpoolEaseServer, type SpoolEaseServer, TEST_SECURITY_KEY } from "./spooleaseServer.js";

const BIN = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
const ENTER = "\r";
const CTRL_C = "\u0003";
const SHOW_CURSOR = "\u001B[?25h";
const WAIT_MS = 8_000;

// Strip CSI/OSC escape sequences so assertions see only the rendered text.
const ANSI = /\u001B\[[0-9;?]*[ -/]*[@-~]|\u001B\][^\u0007]*\u0007/g;

class Terminal {
  raw = "";
  private cursor = 0;
  readonly exited: Promise<number>;
  private readonly pty: IPty;

  constructor(args: string[], env: Record<string, string>) {
    // A minimal env on purpose: CI-like variables would switch Ink to non-interactive rendering.
    this.pty = spawn(process.execPath, [BIN, "tui", ...args], {
      name: "xterm-256color",
      cols: 120,
      rows: 40,
      env: { PATH: process.env.PATH ?? "", TERM: "xterm-256color", ...env },
    });
    this.pty.onData((data) => {
      this.raw += data;
    });
    this.exited = new Promise((resolve) => this.pty.onExit(({ exitCode }) => resolve(exitCode)));
  }

  get text(): string {
    return this.raw.replace(ANSI, "");
  }

  /** Wait until `needle` appears in output rendered after the previous match. */
  async waitFor(needle: string): Promise<void> {
    const deadline = Date.now() + WAIT_MS;
    while (Date.now() < deadline) {
      const index = this.text.indexOf(needle, this.cursor);
      if (index !== -1) {
        this.cursor = index + needle.length;
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out waiting for ${JSON.stringify(needle)}. Output:\n${this.text.slice(-2_000)}`);
  }

  press(keys: string): void {
    this.pty.write(keys);
  }

  kill(): void {
    try {
      this.pty.kill();
    } catch {
      // Already exited.
    }
  }
}

describe("TUI in a real terminal", () => {
  let server: SpoolEaseServer;
  let home: string;
  let terminal: Terminal | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "bambu-hando-pty-"));
    server = await startSpoolEaseServer();
  });

  afterEach(async () => {
    terminal?.kill();
    terminal = undefined;
    await server.close();
  });

  const spooleaseFlags = (key = TEST_SECURITY_KEY): string[] => [
    "--spoolease-host",
    "127.0.0.1",
    "--spoolease-port",
    String(server.port),
    "--spoolease-security-key",
    key,
  ];

  it("applies a full sync, restores the cursor, and exits 0", async () => {
    terminal = new Terminal(["--source", SOURCE_FIXTURE, "--create-spools", ...spooleaseFlags()], { HOME: home });

    await terminal.waitFor("Source (file or URL)");
    terminal.press(ENTER);
    await terminal.waitFor("[a] apply");
    terminal.press("a");
    await terminal.waitFor("Done: 3 written, 0 failed");
    terminal.press("q");

    expect(await terminal.exited).toBe(0);
    expect(terminal.raw.endsWith(SHOW_CURSOR) || terminal.raw.includes(SHOW_CURSOR)).toBe(true);
    expect(await readdir(join(home, ".config", "BambuStudio", "user", "default", "filament"))).toHaveLength(3);
    expect(server.requests.filter((r) => r.path === "/api/spools/add-edit")).toHaveLength(3);
  });

  it("accepts typed input and never echoes the security key from the environment", async () => {
    terminal = new Terminal(["--spoolease-host", "127.0.0.1", "--spoolease-port", String(server.port)], {
      HOME: home,
      SPOOLEASE_SECURITY_KEY: TEST_SECURITY_KEY,
    });

    await terminal.waitFor("Security key");
    terminal.press(SOURCE_FIXTURE);
    await terminal.waitFor("source.json");
    terminal.press(ENTER);
    await terminal.waitFor("3 profiles from");
    await terminal.waitFor("PABC1234");
    terminal.press("q");

    expect(await terminal.exited).toBe(0);
    expect(terminal.raw).not.toContain(TEST_SECURITY_KEY);
    expect(terminal.text).toContain("*******");
  });

  it("shows a rejected key and exits 2", async () => {
    terminal = new Terminal(["--source", SOURCE_FIXTURE, ...spooleaseFlags("WRONG")], { HOME: home });

    await terminal.waitFor("Source (file or URL)");
    terminal.press(ENTER);
    await terminal.waitFor("[a] apply");
    terminal.press("a");
    await terminal.waitFor("SpoolEase key validation failed");
    terminal.press("q");

    expect(await terminal.exited).toBe(2);
    expect(server.requests).toEqual([]);
  });

  it("exits 130 on ctrl+c", async () => {
    terminal = new Terminal(["--source", SOURCE_FIXTURE, "--skip-spoolease"], { HOME: home });

    await terminal.waitFor("Source (file or URL)");
    terminal.press(CTRL_C);

    expect(await terminal.exited).toBe(130);
    expect(terminal.raw).toContain(SHOW_CURSOR);
  });
});
