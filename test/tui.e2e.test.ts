// ABOUTME: End-to-end TUI tests that run the built binary inside a real pseudo-terminal.
// ABOUTME: Sends real keystrokes via node-pty and asserts on rendered frames, files, and exit codes.

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { type IPty, spawn } from "node-pty";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  baseFilamentDir,
  installBambuStudio,
  installSpoolEaseConfig,
  X1C_04,
  X1C_06,
} from "./bambuStudioSetup.js";
import { installFakeLp } from "./fakeLp.js";
import { SOURCE_FIXTURE } from "./parity.js";
import { readPdf } from "./pdf.js";
import {
  type SpoolEaseServer,
  startSpoolEaseServer,
  TEST_SECURITY_KEY,
} from "./spooleaseServer.js";
import { startSpoolmanDbServer } from "./spoolmanDbServer.js";

const BIN = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
const ENTER = "\r";
const CTRL_C = "\u0003";
const DOWN = "\u001B[B";
const UP = "\u001B[A";
const TAB = "\t";
const ESC = "\u001B";
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

class Terminal {
  raw = "";
  private cursor = 0;
  private rawMode = false;
  readonly exited: Promise<number>;
  private readonly pty: IPty;

  constructor(args: string[], env: Record<string, string>, size = { cols: 120, rows: 40 }) {
    // A minimal env on purpose: CI-like variables would switch Ink to non-interactive rendering.
    this.pty = spawn(process.execPath, [BIN, "tui", ...args], {
      name: "xterm-256color",
      cols: size.cols,
      rows: size.rows,
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

  /**
   * Wait until `needle` appears in output rendered after the previous match, and until the app reads
   * keys in raw mode (App's useInput stays active, so raw mode stays on once it is on).
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
      await new Promise((resolve) => setTimeout(resolve, 25));
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

  press(keys: string): void {
    this.pty.write(keys);
  }

  /**
   * One key per write, spaced: keys arriving in one read reach the app as a single input ("s\r"), which
   * matches no key, and a burst of escape sequences reads as one escape.
   */
  async pressEach(...keys: string[]): Promise<void> {
    for (const key of keys) {
      this.pty.write(key);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  resize(cols: number, rows: number): void {
    this.pty.resize(cols, rows);
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
describe("TUI in a real terminal", { timeout: 30_000 }, () => {
  let server: SpoolEaseServer;
  let home: string;
  let terminal: Terminal | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "bambu-hando-pty-"));
    await installBambuStudio(home);
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

  // SOURCE_FIXTURE's brands, Polymaker and Generic, aren't in the test console's empty spool catalog,
  // so each asks for an empty spool weight once; enter keeps the source's.
  async function keepSourceWeights(t: Terminal): Promise<void> {
    for (const step of ["brand 1 of 2", "brand 2 of 2"]) {
      await t.waitFor(step);
      t.press(ENTER);
    }
  }

  it("applies a full sync, restores the cursor, and exits 0", async () => {
    terminal = new Terminal(["--source", SOURCE_FIXTURE, ...spooleaseFlags()], { HOME: home });

    await terminal.waitFor("Add spools from SpoolmanDB");
    terminal.press(ENTER);
    await keepSourceWeights(terminal);
    await terminal.waitFor("register filaments + create spools");
    await terminal.waitFor("[a] apply");
    terminal.press("a");
    await terminal.waitFor("Done: 3 written, 0 failed");
    terminal.press("q");

    expect(await terminal.exited).toBe(0);
    expect(terminal.raw.endsWith(SHOW_CURSOR) || terminal.raw.includes(SHOW_CURSOR)).toBe(true);
    expect(await readdir(baseFilamentDir(home))).toHaveLength(3);
    expect(server.requests.filter((r) => r.path === "/api/spools/add-edit")).toHaveLength(3);
  });

  it("prints labels for the new spools from the summary", async () => {
    const lpLog = await installFakeLp(home);
    terminal = new Terminal(["--source", SOURCE_FIXTURE, ...spooleaseFlags()], { HOME: home });

    await terminal.waitFor("Add spools from SpoolmanDB");
    terminal.press(ENTER);
    await keepSourceWeights(terminal);
    await terminal.waitFor("[a] apply");
    terminal.press("a");
    await terminal.waitFor("[l] labels for 3 new spools");
    terminal.press("l");
    await terminal.waitFor("Labels for 3 new spools");
    // The cursor starts on Make labels; Printer is two rows up. One key per write, spaced: Ink reads a
    // burst of escape sequences as a single (escape) keypress.
    for (const k of [UP, UP, ENTER]) {
      terminal.press(k);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await terminal.waitFor("Don't print");
    for (const k of [DOWN, ENTER]) {
      terminal.press(k);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await terminal.waitFor("Label-Printer");
    for (const k of [DOWN, DOWN, ENTER]) {
      terminal.press(k);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await terminal.waitFor("Sent 3 labels to Label-Printer");
    terminal.press("q");

    expect(await terminal.exited).toBe(0);
    expect(readPdf(await readFile(join(lpLog, "printed.pdf")))).toHaveLength(3);
  });

  it("fits a list to the terminal's height and follows a resize", async () => {
    for (let i = 1; i <= 12; i++) {
      server.spools.push({
        id: String(i),
        brand: "Acme",
        material_type: "PLA",
        color_name: `Color ${i}`,
        color_code: "808080FF",
      });
    }
    terminal = new Terminal(
      ["--skip-spools", ...spooleaseFlags()],
      { HOME: home },
      { cols: 100, rows: 16 },
    );

    await terminal.waitFor("Print labels for existing spools");
    terminal.press("p");
    await terminal.waitFor("Print labels for existing spools");
    terminal.press(ENTER);
    // 16 rows hold 9 of the 12 spools, newest first, around the title, hints and a spare line.
    await terminal.waitFor("#4 Acme PLA Color 4");
    await terminal.waitFor("… 3 more");
    expect(terminal.text).not.toContain("#3 Acme PLA Color 3");

    terminal.resize(100, 30);
    await terminal.waitFor("#1 Acme PLA Color 1");
    terminal.press(CTRL_C);
    expect(await terminal.exited).toBe(130);
  });

  it("reads a scanner's barcode, sent with its enter in one burst", async () => {
    server.customFilaments = "PA000001,Sunlu PETG Elite Red,240,260,PETG";
    server.spools.push({
      id: "1",
      brand: "Sunlu",
      material_type: "PETG",
      color_name: "Red",
      slicer_filament: "PA000001",
    });
    terminal = new Terminal(["--skip-spools", ...spooleaseFlags()], { HOME: home });

    await terminal.waitFor("Barcode: more spools of what you scan");
    await terminal.pressEach("b", ENTER);
    // Not "Barcode: ": the menu's own "Barcode: more spools…" row redraws with it, before the scan screen is up.
    await terminal.waitFor("Scan the spool's barcode, or type it and press enter.");
    terminal.press("00150603Z\r");
    await terminal.waitFor("Which filament is barcode 00150603Z?");
    terminal.press(CTRL_C);
    expect(await terminal.exited).toBe(130);
  });

  it("edits a preset's field, typed in one burst with its enter like a paste, and saves it", async () => {
    const base = baseFilamentDir(home);
    await mkdir(base, { recursive: true });
    const path = join(base, `Red @${X1C_04}.json`);
    const preset = {
      name: `Red @${X1C_04}`,
      inherits: "",
      filament_id: "PA000001",
      nozzle_temperature: ["220"],
      filament_flow_ratio: ["0.98"],
    };
    await writeFile(path, `${JSON.stringify(preset, null, 4)}\n`);
    terminal = new Terminal(["--skip-spoolease"], { HOME: home });

    await terminal.waitFor("Edit a filament preset");
    await terminal.pressEach("e", ENTER);
    await terminal.waitFor("1 in BambuStudio folder default");
    terminal.press(ENTER);
    await terminal.waitFor("Edit Red @ X1 Carbon 0.4 nozzle");
    await terminal.pressEach(ENTER, "\u007F", "\u007F", "\u007F");
    terminal.press("215\r");
    await terminal.waitFor("was 220 °C");
    await terminal.pressEach("\u001B[6~", "\u001B[6~", ENTER);
    await terminal.waitFor("[a] save");
    terminal.press("a");
    await terminal.waitFor("Done: 1 preset saved, 0 failed");
    terminal.press("q");

    expect(await terminal.exited).toBe(0);
    expect(await readFile(path, "utf-8")).toBe(
      `${JSON.stringify({ ...preset, nozzle_temperature: ["215"] }, null, 4)}\n`,
    );
  });

  it("edits a filament's new preset on the plan and writes it with the run", async () => {
    terminal = new Terminal(["--source", SOURCE_FIXTURE, "--skip-spoolease"], { HOME: home });

    await terminal.waitFor("Add spools from SpoolmanDB");
    terminal.press(ENTER);
    await terminal.waitFor("[e] edit presets");
    terminal.press("e");
    await terminal.waitFor("Edit the new presets of which filament?");
    terminal.press(ENTER);
    await terminal.waitFor("the run writes it");
    await terminal.pressEach(DOWN, DOWN, DOWN, ENTER, "\u007F", "\u007F", "\u007F");
    terminal.press("245\r");
    await terminal.waitFor("was 255 °C");
    terminal.press(ESC);
    await terminal.waitFor("✎ PABC1234: 1 change goes into the 1 preset the run writes");
    terminal.press("a");
    await terminal.waitFor("Done: 3 written, 0 failed");
    terminal.press("q");

    expect(await terminal.exited).toBe(0);
    const written = JSON.parse(
      await readFile(join(baseFilamentDir(home), `PETG Red @${X1C_04}.json`), "utf-8"),
    );
    expect(written.nozzle_temperature_range_high).toEqual(["245"]);
  });

  it("accepts typed input and never echoes the security key from the environment", async () => {
    terminal = new Terminal(
      ["--spoolease-host", "127.0.0.1", "--spoolease-port", String(server.port)],
      {
        HOME: home,
        SPOOLEASE_SECURITY_KEY: TEST_SECURITY_KEY,
      },
    );

    await terminal.waitFor("Add spools from SpoolmanDB");
    await terminal.pressEach("s", ENTER);
    await terminal.waitFor("Import file or URL");
    terminal.press(SOURCE_FIXTURE);
    await terminal.waitFor("source.json");
    // Down to the SpoolEase console row and open it, to see the key masked. One key per write, spaced:
    // Ink reads a burst of escape sequences as a single (escape) keypress.
    for (const k of [...Array<string>(6).fill(DOWN), ENTER]) {
      terminal.press(k);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await terminal.waitFor("Security key");
    terminal.press(ESC);
    await terminal.waitFor("Import source.json");
    terminal.press(ENTER);
    await keepSourceWeights(terminal);
    await terminal.waitFor("3 profiles from");
    await terminal.waitFor("PABC1234");
    terminal.press("q");

    expect(await terminal.exited).toBe(0);
    expect(terminal.raw).not.toContain(TEST_SECURITY_KEY);
    expect(terminal.text).toContain("*******");
  });

  it("prefills SpoolEase from BambuStudio's SpoolEase settings without echoing the key", async () => {
    await installSpoolEaseConfig(home, { address: "127.0.0.1", security_key: TEST_SECURITY_KEY });
    terminal = new Terminal(["--source", SOURCE_FIXTURE, "--spoolease-port", String(server.port)], {
      HOME: home,
    });

    await terminal.waitFor("Add spools from SpoolmanDB");
    terminal.press(ENTER);
    await keepSourceWeights(terminal);
    await terminal.waitFor("[a] apply");
    terminal.press("a");
    await terminal.waitFor("Done: 3 written, 0 failed");
    terminal.press("q");

    expect(await terminal.exited).toBe(0);
    expect(server.requests[0]?.path).toBe("/api/test-key");
    expect(terminal.raw).not.toContain(TEST_SECURITY_KEY);
  });

  describe("remembered printers", () => {
    beforeEach(async () => {
      await mkdir(join(home, ".config", "bambu-hando"), { recursive: true });
      await writeFile(
        join(home, ".config", "bambu-hando", "tui.json"),
        JSON.stringify({ printers: [X1C_04, X1C_06] }),
        "utf-8",
      );
    });

    it("starts from the printers of the last run", async () => {
      terminal = new Terminal(["--source", SOURCE_FIXTURE, "--skip-spoolease"], { HOME: home });

      await terminal.waitFor(`${X1C_04}, ${X1C_06}`);
      terminal.press(CTRL_C);
      await terminal.exited;
    });

    it("lets --printer-preset override them", async () => {
      terminal = new Terminal(
        ["--source", SOURCE_FIXTURE, "--skip-spoolease", "--printer-preset", X1C_06],
        { HOME: home },
      );

      await terminal.waitFor("BambuStudio:");
      await terminal.waitFor(X1C_06);
      terminal.press(CTRL_C);
      await terminal.exited;
      expect(terminal.text).not.toContain(X1C_04);
    });
  });

  it("shows a rejected key and exits 2", async () => {
    // Without spools the key is first checked on apply; with them, before the plan (see tui.test.tsx).
    terminal = new Terminal(
      ["--source", SOURCE_FIXTURE, "--skip-spools", ...spooleaseFlags("WRONG")],
      { HOME: home },
    );

    await terminal.waitFor("Add spools from SpoolmanDB");
    terminal.press(ENTER);
    await terminal.waitFor("[a] apply");
    terminal.press("a");
    await terminal.waitFor("SpoolEase key validation failed");
    terminal.press("q");

    expect(await terminal.exited).toBe(2);
    expect(server.requests).toEqual([]);
  });

  it("picks a SpoolmanDB filament prefilled from --brand and applies it", async () => {
    const spoolmanDb = await startSpoolmanDbServer();
    try {
      terminal = new Terminal(["--source", "spoolmandb", "--brand", "RatRig", "--skip-spoolease"], {
        HOME: home,
        SPOOLMANDB_URL: spoolmanDb.url,
      });

      await terminal.waitFor("Add spools from SpoolmanDB");
      terminal.press(ENTER);
      await terminal.waitFor("1 match");
      terminal.press(TAB);
      await terminal.waitFor("1 selected");
      terminal.press(ENTER);
      await terminal.waitFor("[a] apply");
      terminal.press("a");
      await terminal.waitFor("Done: 1 written, 0 failed");
      terminal.press("q");

      expect(await terminal.exited).toBe(0);
      expect(await readdir(baseFilamentDir(home))).toEqual([
        `RatRig ABS Punkfil Brute Black @${X1C_04}.json`,
      ]);
    } finally {
      await spoolmanDb.close();
    }
  });

  it("exits 130 on ctrl+c", async () => {
    terminal = new Terminal(["--source", SOURCE_FIXTURE, "--skip-spoolease"], { HOME: home });

    await terminal.waitFor("Add spools from SpoolmanDB");
    terminal.press(CTRL_C);

    expect(await terminal.exited).toBe(130);
    expect(terminal.raw).toContain(SHOW_CURSOR);
  });
});
