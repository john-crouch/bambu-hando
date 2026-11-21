// ABOUTME: End-to-end tests of the full-screen TUI: the built binary inside a real pseudo-terminal, drawn by xterm.
// ABOUTME: Covers the alternate screen, landing tab, tab cycling, help, the palette, quitting, exit codes and resizing.

import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import xterm from "@xterm/headless";
import { type IPty, spawn } from "node-pty";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installBambuStudio } from "./bambuStudioSetup.js";
import { SOURCE_FIXTURE } from "./parity.js";
import {
  type SpoolEaseServer,
  startSpoolEaseServer,
  TEST_SECURITY_KEY,
} from "./spooleaseServer.js";
import { type SpoolmanDbServer, startSpoolmanDbServer } from "./spoolmanDbServer.js";

const BIN = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
const ENTER = "\r";
const CTRL_C = "\u0003";
const CTRL_K = "\u000B";
const TAB = "\t";
const SHIFT_TAB = "\u001B[Z";
const ESC = "\u001B";
const ENTER_ALT_SCREEN = "\u001B[?1049h";
const LEAVE_ALT_SCREEN = "\u001B[?1049l";
const SHOW_CURSOR = "\u001B[?25h";
const WAIT_MS = 8_000;

// Strip CSI/OSC escape sequences so assertions see only the rendered text.
// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC and BEL delimit the escape sequences this strips.
const ANSI = /\u001B\[[0-9;?]*[ -/]*[@-~]|\u001B\][^\u0007]*\u0007/g;

// Ink draws its first frame before its input effect puts stdin in raw mode. A key sent in that
// window goes through the cooked line discipline (Enter arrives as "\n", not "\r") and is lost.
function rawModeOn(ptsName: string): Promise<boolean> {
  const flag = process.platform === "darwin" ? "-f" : "-F";
  return new Promise((resolve) =>
    execFile("stty", [flag, ptsName, "-a"], (err, stdout) =>
      resolve(!err && /(^|\s)-icanon(\s|$)/.test(stdout)),
    ),
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class Terminal {
  raw = "";
  private cursor = 0;
  private rawMode = false;
  readonly exited: Promise<number>;
  private readonly pty: IPty;
  private readonly screenBuffer: xterm.Terminal;

  constructor(args: string[], env: Record<string, string>, size = { cols: 120, rows: 36 }) {
    this.screenBuffer = new xterm.Terminal({ ...size, allowProposedApi: true });
    // A minimal env on purpose: CI-like variables would switch Ink to non-interactive rendering.
    this.pty = spawn(process.execPath, [BIN, "tui", ...args], {
      name: "xterm-256color",
      cols: size.cols,
      rows: size.rows,
      env: { PATH: process.env.PATH ?? "", TERM: "xterm-256color", ...env },
    });
    this.pty.onData((data) => {
      this.raw += data;
      this.screenBuffer.write(data);
    });
    this.exited = new Promise((resolve) => this.pty.onExit(({ exitCode }) => resolve(exitCode)));
  }

  get text(): string {
    return this.raw.replace(ANSI, "");
  }

  /** The screen's lines as the terminal shows them now. */
  async screen(): Promise<string[]> {
    await new Promise<void>((resolve) => this.screenBuffer.write("", resolve));
    const buffer = this.screenBuffer.buffer.active;
    return Array.from(
      { length: this.screenBuffer.rows },
      (_, row) => buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? "",
    );
  }

  /** Wait until some line of the screen passes test. */
  /**
   * Waits until text is on the drawn screen. Prefer this to waitFor for text that replaces other text on
   * the same line (one help title after another): Ink 8 rewrites only the changed part of a line.
   */
  async waitForOnScreen(text: string): Promise<string[]> {
    return this.waitForScreen(
      (lines) => lines.some((line) => line.includes(text)),
      JSON.stringify(text),
    );
  }

  async waitForScreen(test: (lines: string[]) => boolean, what: string): Promise<string[]> {
    const deadline = Date.now() + WAIT_MS;
    while (Date.now() < deadline) {
      const lines = await this.screen();
      if (test(lines)) return lines;
      await sleep(25);
    }
    throw new Error(`Timed out waiting for ${what}. Screen:\n${(await this.screen()).join("\n")}`);
  }

  /**
   * Wait until `needle` appears in output rendered after the previous match, and until the app reads
   * keys in raw mode (the shell's useInput stays active, so raw mode stays on once it is on).
   */
  async waitFor(needle: string): Promise<void> {
    const deadline = Date.now() + WAIT_MS;
    let found = false;
    while (Date.now() < deadline) {
      if (!found) {
        const index = this.text.indexOf(needle, this.cursor);
        if (index !== -1) {
          this.cursor = index + needle.length;
          found = true;
        }
      }
      if (found && !this.rawMode) this.rawMode = await rawModeOn(this.ptsName);
      if (found && this.rawMode) return;
      await sleep(25);
    }
    const what = found ? "raw mode after" : "";
    throw new Error(
      `Timed out waiting for ${what} ${JSON.stringify(needle)}. Output:\n${this.text.slice(-2_000)}`,
    );
  }

  // node-pty's UnixTerminal has ptsName at runtime, but its typings leave it out.
  private get ptsName(): string {
    return (this.pty as unknown as { ptsName: string }).ptsName;
  }

  /**
   * One key per write, spaced: keys arriving in one read reach the app as a single input, which
   * matches no key, and a burst of escape sequences reads as one escape.
   */
  async pressEach(...keys: string[]): Promise<void> {
    for (const key of keys) {
      this.pty.write(key);
      await sleep(30);
    }
  }

  resize(cols: number, rows: number): void {
    this.pty.resize(cols, rows);
    this.screenBuffer.resize(cols, rows);
  }

  kill(): void {
    try {
      this.pty.kill();
    } catch {
      // Already exited.
    }
  }
}

// Each waitFor may take WAIT_MS, and a test chains several; vitest's 5 s default cut slow runs short.
describe("full-screen TUI in a real terminal", { timeout: 30_000 }, () => {
  let server: SpoolEaseServer;
  // Tests never reach the internet: Add loads SpoolmanDB from this stand-in on its first visit.
  let spoolmanDb: SpoolmanDbServer;
  let home: string;
  let terminal: Terminal | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "bambu-hando-pty-"));
    await installBambuStudio(home);
    server = await startSpoolEaseServer();
    spoolmanDb = await startSpoolmanDbServer();
  });

  afterEach(async () => {
    terminal?.kill();
    terminal = undefined;
    await server.close();
    await spoolmanDb.close();
  });

  const consoleFlags = (key = TEST_SECURITY_KEY): string[] => [
    "--spoolease-host",
    "127.0.0.1",
    "--spoolease-port",
    String(server.port),
    "--spoolease-security-key",
    key,
  ];

  const start = (args: string[], size?: { cols: number; rows: number }) => {
    terminal = new Terminal(args, { HOME: home, SPOOLMANDB_URL: spoolmanDb.url }, size);
    return terminal;
  };

  it("draws in the alternate screen, lands on Spools with a console, and leaves on q with 0", async () => {
    const t = start(consoleFlags());

    await t.waitFor("✓ SpoolEase 127.0.0.1");
    expect(t.raw).toContain(ENTER_ALT_SCREEN);
    await t.pressEach("?");
    await t.waitForOnScreen("Help · Spools");
    await t.pressEach(ESC, "q");

    expect(await t.exited).toBe(0);
    expect(t.raw.lastIndexOf(LEAVE_ALT_SCREEN)).toBeGreaterThan(t.raw.indexOf(ENTER_ALT_SCREEN));
    expect(t.raw).toContain(SHOW_CURSOR);
    // The key never reaches the screen.
    expect(t.text).not.toContain(TEST_SECURITY_KEY);
  });

  it("quits on q right away, even while a SpoolmanDB download is still waiting for an answer", async () => {
    let asked = 0;
    // A catalog server that takes the request and never answers it.
    const hanging: Server = createServer(() => {
      asked += 1;
    });
    await new Promise<void>((resolve) => hanging.listen(0, "127.0.0.1", resolve));
    const { port } = hanging.address() as AddressInfo;
    try {
      terminal = new Terminal(["--source", "spoolmandb", "--skip-spoolease"], {
        HOME: home,
        SPOOLMANDB_URL: `http://127.0.0.1:${port}`,
      });
      // waitFor also waits for raw mode, so q isn't lost; landing on Add asks for the catalog right away.
      await terminal.waitFor("SpoolEase skipped");
      await terminal.waitForScreen(() => asked > 0, "the catalog request");
      await terminal.pressEach("q");
      const quit = await Promise.race([
        terminal.exited,
        new Promise<string>((resolve) => setTimeout(() => resolve("still running"), 3_000)),
      ]);
      expect(quit).toBe(0);
    } finally {
      hanging.closeAllConnections();
      await new Promise((resolve) => hanging.close(resolve));
    }
  });

  it("lands on Add without a console, and says the console is skipped", async () => {
    const t = start(["--source", SOURCE_FIXTURE, "--skip-spoolease"]);

    await t.waitFor("SpoolEase skipped");
    await t.pressEach("?");
    await t.waitForOnScreen("Help · Add");
  });

  it("shows a rejected key as an unreachable console", async () => {
    const t = start(consoleFlags("WRONG"));

    await t.waitFor("✗ SpoolEase 127.0.0.1");
  });

  it("cycles tabs with tab and shift+tab, wrapping around", async () => {
    const t = start(consoleFlags());
    await t.waitFor("Spools");

    // The drawn screen, not the output stream: going from "Help · Add" to "Help · Presets", Ink 8
    // rewrites only the changed part of the line, so the whole title may never pass by in one piece.
    const helpFor = (title: string) => t.waitForOnScreen(`Help · ${title}`);
    for (const title of ["Add", "Presets", "Check", "Settings", "Spools"]) {
      await t.pressEach(TAB, "?");
      await helpFor(title);
      await t.pressEach(ESC);
    }
    await t.pressEach(SHIFT_TAB, "?");
    await helpFor("Settings");
  });

  it("keeps both keys when tab and ? arrive in one read", async () => {
    const t = start(consoleFlags());
    await t.waitFor("Spools");

    // One write: the pty hands both keys to the app in one read, as a busy machine does.
    await t.pressEach(`${TAB}?`);
    await t.waitForOnScreen("Help · Add");
  });

  it("keeps both keys when esc and the next key arrive in one read", async () => {
    const t = start(consoleFlags());
    await t.waitFor("Spools");

    await t.pressEach("?");
    await t.waitForOnScreen("Help · Spools");
    // One write: Ink reads it as meta+tab. The shell splits it: esc closes help, tab goes to Add.
    await t.pressEach(ESC + TAB, "?");
    await t.waitForOnScreen("Help · Add");
  });

  it("opens help with ?, which lists the global keys, and closes on any key", async () => {
    const t = start(consoleFlags());
    await t.waitFor("Spools");

    await t.pressEach("?");
    await t.waitFor("Everywhere");
    const lines = await t.waitForScreen(
      (screen) => screen.some((line) => line.includes("shift+tab")),
      "the global keys",
    );
    expect(lines.some((line) => line.includes("ctrl+k"))).toBe(true);
    await t.pressEach("x");
    await t.waitForScreen(
      (screen) => !screen.some((line) => line.includes("Everywhere")),
      "help to close",
    );
  });

  it("floats help in a blank halo over the body, as the terminal draws it", async () => {
    // Spools whose rows run under the dialog's sides, so a missing halo shows.
    for (let id = 1; id <= 30; id++)
      server.spools.push({
        id: String(id),
        brand: "Polymaker",
        material_type: "PETG",
        color_name: "Very Long Color Name That Runs Under The Dialog",
        color_code: "112233FF",
        weight_advertised: "1000",
        weight_current: "500",
        slicer_filament: "PABC1234",
      });
    const t = start(consoleFlags());
    await t.waitFor("#30");

    await t.pressEach("?");
    const lines = await t.waitForScreen(
      (screen) => screen.some((line) => line.includes("quit right away")),
      "help's last key",
    );
    const top = lines.findIndex((line) => line.includes("╭ Help · Spools"));
    const bottom = lines.findIndex((line, index) => index > top && line.includes("╰"));
    const left = lines[top]?.indexOf("╭") ?? -1;
    const right = lines[top]?.indexOf("╮", left) ?? -1;
    expect([top > 1, bottom > top, left > 1, right > left]).toEqual([true, true, true, true]);
    // A blank cell each side of every row of it, and blank rows above and below it.
    for (let row = top; row <= bottom; row++) {
      expect(lines[row]?.[left - 1], `row ${row}`).toBe(" ");
      expect(lines[row]?.[right + 1], `row ${row}`).toBe(" ");
    }
    for (const row of [top - 1, bottom + 1])
      expect(lines[row]?.slice(left - 1, right + 2).trim(), `row ${row}`).toBe("");
  });

  it("finds a command in the palette with ctrl+k and runs it", async () => {
    const t = start(consoleFlags());
    await t.waitFor("Spools");

    await t.pressEach(CTRL_K);
    await t.waitFor("Type to find a command");
    await t.pressEach(..."go to check");
    await t.waitFor("› go to check");
    await t.pressEach(ENTER, "?");
    await t.waitForOnScreen("Help · Check");
    await t.pressEach(ESC, CTRL_K, ..."quit", ENTER);

    expect(await t.exited).toBe(0);
  });

  it("exits 130 on ctrl+c, from an overlay too", async () => {
    const t = start(consoleFlags());
    await t.waitFor("Spools");

    await t.pressEach(CTRL_K);
    await t.waitFor("Type to find a command");
    await t.pressEach(CTRL_C);

    expect(await t.exited).toBe(130);
    expect(t.raw.lastIndexOf(LEAVE_ALT_SCREEN)).toBeGreaterThan(t.raw.indexOf(ENTER_ALT_SCREEN));
  });

  it("follows a resize: the frame refits the terminal", async () => {
    const t = start(consoleFlags(), { cols: 120, rows: 36 });
    await t.waitFor("✓ SpoolEase 127.0.0.1");
    let lines = await t.waitForScreen(
      (screen) => (screen[0] ?? "").includes("X1C 0.4") && (screen[35] ?? "").includes("? help"),
      "the header's printer and the footer on the last row",
    );

    t.resize(80, 24);
    lines = await t.waitForScreen(
      (screen) =>
        (screen[0] ?? "").includes("✓ SpoolEase 127.0.0.1") &&
        !(screen[0] ?? "").includes("X1C") &&
        (screen[23] ?? "").includes("? help"),
      "the header and footer refit to 80x24",
    );
    expect(lines[0]).toContain("bambu-hando");

    await t.pressEach("?");
    await t.waitForOnScreen("Help · Spools");
    lines = await t.waitForScreen(
      (screen) => screen.some((line) => line.includes("╭") && line.length <= 80),
      "help within 80 columns",
    );
    expect(lines.every((line) => line.length <= 80)).toBe(true);
  });
});

describe("bambu-hando tui --help", () => {
  it("prints the TUI's own short usage with its keys, not the headless help", async () => {
    const { code, stdout } = await new Promise<{ code: number; stdout: string }>((resolve) => {
      execFile(process.execPath, [BIN, "tui", "--help"], (err, out) =>
        resolve({ code: err ? Number(err.code ?? 1) : 0, stdout: out }),
      );
    });
    expect(code).toBe(0);
    expect(stdout).toMatch(/^Usage: bambu-hando tui \[options\]\n/);
    expect(stdout).toContain("ctrl+k");
    expect(stdout).toContain("shift+tab");
    expect(stdout).toContain("--printer-preset");
    // Headless-only flags and the other commands stay in the main help.
    expect(stdout).not.toContain("--dry-run");
    expect(stdout).not.toContain("--label-output");
    expect(stdout).not.toContain("bambu-hando labels");
    for (const line of stdout.split("\n")) expect(line.length).toBeLessThanOrEqual(80);
  });
});
