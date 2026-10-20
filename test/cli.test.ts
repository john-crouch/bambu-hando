// ABOUTME: Integration tests for the headless CLI: flags, report format, and exit codes.
// ABOUTME: Runs main() in-process against a local SpoolEase server and a temporary HOME.

import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { main } from "../src/cli.js";
import { SOURCE_FIXTURE } from "./parity.js";
import { startSpoolEaseServer, type SpoolEaseServer, TEST_SECURITY_KEY } from "./spooleaseServer.js";

interface Captured {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(argv: string[]): Promise<Captured> {
  let stdout = "";
  let stderr = "";
  const code = await main(argv, { stdout: (s) => (stdout += s), stderr: (s) => (stderr += s) });
  return { code, stdout, stderr };
}

describe("cli", () => {
  let server: SpoolEaseServer;
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "bambu-hando-home-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("SPOOLEASE_HOST", undefined);
    vi.stubEnv("SPOOLEASE_SECURITY_KEY", undefined);
    server = await startSpoolEaseServer();
  });

  afterEach(async () => {
    await server.close();
  });

  const spooleaseArgs = (): string[] => [
    "--spoolease-host",
    "127.0.0.1",
    "--spoolease-port",
    String(server.port),
    "--spoolease-security-key",
    TEST_SECURITY_KEY,
  ];

  it("prints a snake_case JSON report and exits 0 when everything is written", async () => {
    const { code, stdout } = await run(["--source", SOURCE_FIXTURE, ...spooleaseArgs()]);

    expect(code).toBe(0);
    const report = JSON.parse(stdout);
    expect(report).toMatchObject({ source: SOURCE_FIXTURE, dry_run: false, profiles_count: 3 });
    expect(report.bambu_preset_paths).toHaveLength(3);
    expect(report.results[0]).toEqual({
      profile_name: "PETG Red",
      bambu_status: "written",
      spoolease_status: "written",
      detail: "HTTP 200: {}",
    });
  });

  it("exits 0 with --skip-spoolease", async () => {
    const { code, stdout } = await run(["--source", SOURCE_FIXTURE, "--skip-spoolease"]);

    expect(code).toBe(0);
    expect(JSON.parse(stdout).results[0].spoolease_status).toBe("skipped");
    expect(server.requests).toEqual([]);
  });

  it("plans in dry-run without writing anything", async () => {
    const { code, stdout } = await run(["--source", SOURCE_FIXTURE, "--dry-run", ...spooleaseArgs()]);

    expect(code).toBe(0);
    expect(JSON.parse(stdout).results[0]).toMatchObject({ bambu_status: "planned", spoolease_status: "planned" });
    expect(await readdir(home)).toEqual([]);
  });

  it("reads SpoolEase host and key from the environment", async () => {
    vi.stubEnv("SPOOLEASE_HOST", "127.0.0.1");
    vi.stubEnv("SPOOLEASE_SECURITY_KEY", TEST_SECURITY_KEY);

    const { code } = await run(["--source", SOURCE_FIXTURE, "--spoolease-port", String(server.port)]);

    expect(code).toBe(0);
    expect(server.requests[0]?.path).toBe("/api/test-key");
  });

  it("exits 1 when a spool write fails", async () => {
    server.replies["/api/spools/add-edit"] = { status: 500, body: "boom" };

    const { code, stdout } = await run(["--source", SOURCE_FIXTURE, ...spooleaseArgs()]);

    expect(code).toBe(1);
    expect(JSON.parse(stdout).results[0]).toMatchObject({ spoolease_status: "failed", detail: "HTTP 500: boom" });
  });

  it("warns on stderr when the custom filaments CSV fails", async () => {
    server.replies["/api/filaments-config"] = { status: 500, body: "boom" };

    const { code, stderr } = await run(["--source", SOURCE_FIXTURE, ...spooleaseArgs()]);

    expect(code).toBe(1);
    expect(stderr).toBe("Failed to set custom filaments CSV: 500 boom\n");
  });

  it("exits 2 when the SpoolEase key is rejected", async () => {
    const { code, stdout, stderr } = await run([
      "--source",
      SOURCE_FIXTURE,
      "--spoolease-host",
      "127.0.0.1",
      "--spoolease-port",
      String(server.port),
      "--spoolease-security-key",
      "WRONG",
    ]);

    expect(code).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toBe("SpoolEase key validation failed\n");
  });

  it("writes the report to --report as well as stdout", async () => {
    const reportPath = join(home, "report.json");

    const { stdout } = await run(["--source", SOURCE_FIXTURE, "--skip-spoolease", "--report", reportPath]);

    expect(await readFile(reportPath, "utf-8")).toBe(stdout);
  });

  it.each([
    [[], "--source is required"],
    [["--source", SOURCE_FIXTURE], "SpoolEase host and security key are required unless --skip-spoolease is set"],
    [["--source", SOURCE_FIXTURE, "--skip-spoolease", "--spoolease-port", "eighty"], "--spoolease-port must be a port number"],
    [["--source", SOURCE_FIXTURE, "--bogus"], "Unknown option '--bogus'"],
    [["frobnicate"], "unknown command 'frobnicate'"],
  ])("exits 2 with usage for invalid arguments %j", async (argv, message) => {
    const { code, stdout, stderr } = await run(argv);

    expect(code).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toContain(`bambu-hando: error: ${message}`);
    expect(stderr).toContain("Usage:");
  });

  it("exits 1 with a message when the source cannot be loaded", async () => {
    const { code, stderr } = await run(["--source", join(home, "missing.json"), "--skip-spoolease"]);

    expect(code).toBe(1);
    expect(stderr).toMatch(/^bambu-hando: error: ENOENT/);
  });

  it("prints usage with --help", async () => {
    const { code, stdout } = await run(["--help"]);

    expect(code).toBe(0);
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("bambu-hando tui");
  });

  it("refuses to start the TUI without an interactive terminal", async () => {
    const { code, stderr } = await run(["tui"]);

    expect(code).toBe(2);
    expect(stderr).toContain("bambu-hando tui needs an interactive terminal");
  });
});
