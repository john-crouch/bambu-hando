// ABOUTME: Integration tests for the Ink TUI: setup form, plan view, live apply, and exit codes.
// ABOUTME: Drives the real sync against a local SpoolEase server and a temporary HOME.

import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { render } from "ink-testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App, type FormValues } from "../src/tui/App.js";
import { SOURCE_FIXTURE } from "./parity.js";
import { startSpoolEaseServer, type SpoolEaseServer, TEST_SECURITY_KEY } from "./spooleaseServer.js";

const ENTER = "\r";
const DOWN = "\u001B[B";

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

describe("TUI", () => {
  let server: SpoolEaseServer;
  let home: string;
  let onExit: ReturnType<typeof vi.fn<(code: number) => void>>;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "bambu-hando-tui-"));
    vi.stubEnv("HOME", home);
    server = await startSpoolEaseServer();
    onExit = vi.fn<(code: number) => void>();
  });

  afterEach(async () => {
    await server.close();
  });

  function values(overrides: Partial<FormValues> = {}): FormValues {
    return {
      source: SOURCE_FIXTURE,
      presetFolder: "default",
      printerPreset: "X1C",
      host: "127.0.0.1",
      port: String(server.port),
      securityKey: TEST_SECURITY_KEY,
      https: false,
      skipSpoolease: false,
      createSpools: false,
      ...overrides,
    };
  }

  async function press(stdin: { write: (data: string) => void }, ...keys: string[]): Promise<void> {
    for (const key of keys) {
      stdin.write(key);
      await settle();
    }
  }

  it("masks the security key on the setup form", async () => {
    const { lastFrame } = render(<App initial={values()} onExit={onExit} />);
    await settle();

    expect(lastFrame()).toContain("Security key");
    expect(lastFrame()).not.toContain(TEST_SECURITY_KEY);
  });

  it("requires a source before loading", async () => {
    const { lastFrame, stdin } = render(<App initial={values({ source: "" })} onExit={onExit} />);
    await settle();

    await press(stdin, ENTER);

    expect(lastFrame()).toContain("Source is required");
  });

  it("accepts typed input and shows the plan with swatches, codes, and targets", async () => {
    const { lastFrame, stdin } = render(<App initial={values({ source: "" })} onExit={onExit} />);
    await settle();

    await press(stdin, SOURCE_FIXTURE, ENTER);

    await vi.waitFor(() => expect(lastFrame()).toContain("3 profiles"));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("PETG Red");
    expect(frame).toContain("FF2200FF");
    expect(frame).toContain("PABC1234");
    expect(frame).toContain("Pb1a2a16");
    expect(frame).toContain("230-255");
    expect(frame).toContain(join(home, ".config", "BambuStudio", "user", "default", "filament"));
    expect(frame).toContain(`127.0.0.1:${server.port}`);
    expect(server.requests).toEqual([]);
  });

  it("shows source loading errors on the form", async () => {
    const { lastFrame, stdin } = render(<App initial={values({ source: join(home, "missing.json") })} onExit={onExit} />);
    await settle();

    await press(stdin, ENTER);

    await vi.waitFor(() => expect(lastFrame()).toContain("ENOENT"));
    expect(lastFrame()).toContain("Source");
  });

  it("toggles skip SpoolEase so host and key are no longer required", async () => {
    const { lastFrame, stdin } = render(<App initial={values({ host: "", securityKey: "" })} onExit={onExit} />);
    await settle();

    await press(stdin, ENTER);
    expect(lastFrame()).toContain("SpoolEase host and security key are required");

    // source, preset folder, printer preset, host, port, key, https, skip
    await press(stdin, DOWN, DOWN, DOWN, DOWN, DOWN, DOWN, DOWN, " ", ENTER);

    await vi.waitFor(() => expect(lastFrame()).toContain("SpoolEase: skipped"));
  });

  it("applies with live statuses, registers filaments without spools, and exits 0", async () => {
    const { lastFrame, stdin } = render(<App initial={values()} onExit={onExit} />);
    await settle();

    await press(stdin, ENTER);
    await vi.waitFor(() => expect(lastFrame()).toContain("[a] apply"));
    expect(lastFrame()).toContain("register filaments only");
    await press(stdin, "a");

    await vi.waitFor(() => expect(lastFrame()).toContain("Done: 3 written, 0 failed"));
    expect(await readdir(join(home, ".config", "BambuStudio", "user", "default", "filament"))).toHaveLength(3);
    expect(server.customFilaments?.split("\r\n")).toHaveLength(3);
    expect(server.spools).toEqual([]);

    await press(stdin, "q");
    expect(onExit).toHaveBeenCalledWith(0);
  });

  it("creates spools when the Create spools toggle is on", async () => {
    const { lastFrame, stdin } = render(<App initial={values()} onExit={onExit} />);
    await settle();

    // source, preset folder, printer preset, host, port, key, https, skip, create spools
    await press(stdin, DOWN, DOWN, DOWN, DOWN, DOWN, DOWN, DOWN, DOWN, " ", ENTER);
    await vi.waitFor(() => expect(lastFrame()).toContain("register filaments + create spools"));
    await press(stdin, "a");

    await vi.waitFor(() => expect(lastFrame()).toContain("Done: 3 written, 0 failed"));
    expect(server.spools.map((s) => s.slicer_filament)).toEqual(["PABC1234", "Pb1a2a16", "Pd73077d"]);
  });

  it("lists failure details and exits 1 when a profile fails", async () => {
    server.replies["/api/spools/add-edit"] = { status: 500, body: "spool store full" };
    const { lastFrame, stdin } = render(<App initial={values({ createSpools: true })} onExit={onExit} />);
    await settle();

    await press(stdin, ENTER);
    await vi.waitFor(() => expect(lastFrame()).toContain("[a] apply"));
    await press(stdin, "a");

    await vi.waitFor(() => expect(lastFrame()).toContain("Done: 0 written, 3 failed"));
    expect(lastFrame()).toContain("HTTP 500: spool store full");

    await press(stdin, "q");
    expect(onExit).toHaveBeenCalledWith(1);
  });

  it("shows key check errors and exits 2", async () => {
    const { lastFrame, stdin } = render(<App initial={values({ securityKey: "WRONG" })} onExit={onExit} />);
    await settle();

    await press(stdin, ENTER);
    await vi.waitFor(() => expect(lastFrame()).toContain("[a] apply"));
    await press(stdin, "a");

    await vi.waitFor(() => expect(lastFrame()).toContain("SpoolEase key validation failed"));
    expect(server.requests.map((r) => r.path)).toEqual([]);

    await press(stdin, "q");
    expect(onExit).toHaveBeenCalledWith(2);
  });

  it("goes back from the plan to the form", async () => {
    const { lastFrame, stdin } = render(<App initial={values()} onExit={onExit} />);
    await settle();

    await press(stdin, ENTER);
    await vi.waitFor(() => expect(lastFrame()).toContain("[a] apply"));
    await press(stdin, "b");

    await vi.waitFor(() => expect(lastFrame()).toContain("Printer preset"));
  });
});
