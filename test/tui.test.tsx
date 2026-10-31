// ABOUTME: Integration tests for the Ink TUI: setup form, plan view, live apply, and exit codes.
// ABOUTME: Drives the real sync against a local SpoolEase server and a temporary HOME.

import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { render } from "ink-testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App, type FormValues } from "../src/tui/App.js";
import { SOURCE_FIXTURE } from "./parity.js";
import { SPOOLS_CATALOG, startSpoolEaseServer, type SpoolEaseServer, TEST_SECURITY_KEY } from "./spooleaseServer.js";
import { startSpoolmanDbServer, type SpoolmanDbServer } from "./spoolmanDbServer.js";
import { baseFilamentDir, installBambuStudio, X1C_04, X1C_06 } from "./bambuStudioSetup.js";

const ENTER = "\r";
const DOWN = "\u001B[B";
const TAB = "\t";
const ESC = "\u001B";
const CTRL_A = "\u0001";
const BACKSPACE = "\u007F";

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

describe("TUI", () => {
  let server: SpoolEaseServer;
  let spoolmanDb: SpoolmanDbServer;
  let home: string;
  let onExit: ReturnType<typeof vi.fn<(code: number) => void>>;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "bambu-hando-tui-"));
    vi.stubEnv("HOME", home);
    await installBambuStudio(home);
    vi.stubEnv("XDG_CACHE_HOME", undefined);
    server = await startSpoolEaseServer();
    spoolmanDb = await startSpoolmanDbServer();
    vi.stubEnv("SPOOLMANDB_URL", spoolmanDb.url);
    onExit = vi.fn<(code: number) => void>();
  });

  afterEach(async () => {
    await server.close();
    await spoolmanDb.close();
  });

  function values(overrides: Partial<FormValues> = {}): FormValues {
    return {
      source: SOURCE_FIXTURE,
      presetFolder: "default",
      printerPreset: X1C_04,
      host: "127.0.0.1",
      port: String(server.port),
      securityKey: TEST_SECURITY_KEY,
      https: false,
      skipSpoolease: false,
      createSpools: true,
      overwritePresets: false,
      query: "",
      diameter: 1.75,
      ...overrides,
    };
  }

  async function press(stdin: { write: (data: string) => void }, ...keys: string[]): Promise<void> {
    for (const key of keys) {
      stdin.write(key);
      await settle();
    }
  }

  // SOURCE_FIXTURE's brands, Polymaker and Generic (the brandless profiles), aren't in the test console's
  // empty catalog, so each asks once; enter keeps the source's weight.
  async function keepSourceWeights(stdin: { write: (data: string) => void }, lastFrame: () => string | undefined): Promise<void> {
    for (const step of ["brand 1 of 2", "brand 2 of 2"]) {
      await vi.waitFor(() => expect(lastFrame()).toContain(step));
      await press(stdin, ENTER);
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
    await keepSourceWeights(stdin, lastFrame);

    await vi.waitFor(() => expect(lastFrame()).toContain("3 profiles"));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("PETG Red");
    expect(frame).toContain("FF2200FF");
    expect(frame).toContain("PABC1234");
    expect(frame).toContain("Pb1a2a16");
    expect(frame).toContain("230-255");
    expect(frame).toContain(baseFilamentDir(home));
    expect(frame).toContain(`127.0.0.1:${server.port}`);
    expect(frame).toContain("200 g");
    expect(server.requests.map((r) => r.path)).toEqual(["/api/test-key", "/api/spools-config", "/spools-catalog"]);
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

    // source, preset folder, printer preset, overwrite presets, host, port, key, https, skip
    await press(stdin, DOWN, DOWN, DOWN, DOWN, DOWN, DOWN, DOWN, DOWN, " ", ENTER);

    await vi.waitFor(() => expect(lastFrame()).toContain("SpoolEase: skipped"));
  });

  it("applies with live statuses, registers filaments without spools, and exits 0", async () => {
    const { lastFrame, stdin } = render(<App initial={values({ createSpools: false })} onExit={onExit} />);
    await settle();

    await press(stdin, ENTER);
    await vi.waitFor(() => expect(lastFrame()).toContain("[a] apply"));
    expect(lastFrame()).toContain("register filaments only");
    await press(stdin, "a");

    await vi.waitFor(() => expect(lastFrame()).toContain("Done: 3 written, 0 failed"));
    expect(await readdir(baseFilamentDir(home))).toHaveLength(3);
    expect(server.customFilaments?.split("\r\n")).toHaveLength(3);
    expect(server.spools).toEqual([]);

    await press(stdin, "q");
    expect(onExit).toHaveBeenCalledWith(0);
  });

  it("keeps existing presets unless the Overwrite presets toggle is on", async () => {
    const { lastFrame, stdin } = render(<App initial={values({ skipSpoolease: true })} onExit={onExit} />);
    await settle();

    await press(stdin, ENTER);
    await vi.waitFor(() => expect(lastFrame()).toContain("existing presets kept"));
    await press(stdin, "b");
    // source, preset folder, printer preset, overwrite presets
    await press(stdin, DOWN, DOWN, DOWN, " ", ENTER);
    await vi.waitFor(() => expect(lastFrame()).toContain("existing presets replaced"));
  });

  it("creates spools unless the Create spools toggle is switched off", async () => {
    const { lastFrame, stdin } = render(<App initial={values()} onExit={onExit} />);
    await settle();

    await press(stdin, ENTER);
    await keepSourceWeights(stdin, lastFrame);
    await vi.waitFor(() => expect(lastFrame()).toContain("register filaments + create spools"));
    await press(stdin, "b");
    // source, preset folder, printer preset, overwrite presets, host, port, key, https, skip, create spools
    await press(stdin, DOWN, DOWN, DOWN, DOWN, DOWN, DOWN, DOWN, DOWN, DOWN, " ", ENTER);
    await vi.waitFor(() => expect(lastFrame()).toContain("register filaments only"));
    await press(stdin, "a");

    await vi.waitFor(() => expect(lastFrame()).toContain("Done: 3 written, 0 failed"));
    expect(server.customFilaments?.split("\r\n")).toHaveLength(3);
    expect(server.spools).toEqual([]);
  });

  it("lists failure details and exits 1 when a profile fails", async () => {
    server.replies["/api/spools/add-edit"] = { status: 500, body: "spool store full" };
    const { lastFrame, stdin } = render(<App initial={values()} onExit={onExit} />);
    await settle();

    await press(stdin, ENTER);
    await keepSourceWeights(stdin, lastFrame);
    await vi.waitFor(() => expect(lastFrame()).toContain("[a] apply"));
    await press(stdin, "a");

    await vi.waitFor(() => expect(lastFrame()).toContain("Done: 0 written, 3 failed"));
    expect(lastFrame()).toContain("HTTP 500: spool store full");

    await press(stdin, "q");
    expect(onExit).toHaveBeenCalledWith(1);
  });

  it("shows key check errors and exits 2", async () => {
    const { lastFrame, stdin } = render(<App initial={values({ securityKey: "WRONG", createSpools: false })} onExit={onExit} />);
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
    await keepSourceWeights(stdin, lastFrame);
    await vi.waitFor(() => expect(lastFrame()).toContain("[a] apply"));
    await press(stdin, "b");

    await vi.waitFor(() => expect(lastFrame()).toContain("Printer preset"));
  });

  it("searches SpoolmanDB, picks filaments with tab, and applies them", async () => {
    const { lastFrame, stdin } = render(<App initial={values({ source: "spoolmandb" })} onExit={onExit} />);
    await settle();

    await press(stdin, ENTER);
    await vi.waitFor(() => expect(lastFrame()).toContain("SpoolmanDB: 9 filaments"));
    await press(stdin, "3dhojor", "x");
    await vi.waitFor(() => expect(lastFrame()).toContain("0 match"));
    await press(stdin, BACKSPACE);
    await vi.waitFor(() => expect(lastFrame()).toContain("3 match"));
    expect(lastFrame()).toContain("3DHoJor PLA-CF Brown");
    expect(lastFrame()).not.toContain("Polymaker");

    await press(stdin, TAB, TAB);
    await vi.waitFor(() => expect(lastFrame()).toContain("2 selected"));
    await press(stdin, ENTER);
    await vi.waitFor(() => expect(lastFrame()).toContain("Empty spool weight: 3DHoJor"));
    await press(stdin, ENTER);
    await vi.waitFor(() => expect(lastFrame()).toContain("2 profiles from spoolmandb"));
    expect(lastFrame()).toContain("Pccd78d1");
    expect(lastFrame()).toContain("Pd6ef068");

    await press(stdin, "a");
    await vi.waitFor(() => expect(lastFrame()).toContain("Done: 2 written, 0 failed"));
    expect(await readdir(baseFilamentDir(home))).toHaveLength(2);
    expect(server.customFilaments).toBe("Pccd78d1,3DHoJor ABS+ Brown,230,270,ABS+\r\nPd6ef068,3DHoJor PLA-CF Brown,210,230,PLA-CF");
  });

  it("prefills the search and selects every match with ctrl+a", async () => {
    const { lastFrame, stdin } = render(<App initial={values({ source: "spoolmandb", query: "polylite" })} onExit={onExit} />);
    await settle();

    await press(stdin, ENTER);
    await vi.waitFor(() => expect(lastFrame()).toContain("1 match"));
    await press(stdin, CTRL_A);
    await vi.waitFor(() => expect(lastFrame()).toContain("1 selected"));
    await press(stdin, ENTER);
    await vi.waitFor(() => expect(lastFrame()).toContain("Empty spool weight: Polymaker"));
    await press(stdin, ENTER);

    await vi.waitFor(() => expect(lastFrame()).toContain("1 profiles from spoolmandb"));
    expect(lastFrame()).toContain("Peddfd02");
  });

  it("asks for a selection, and escape returns to the form", async () => {
    const { lastFrame, stdin } = render(<App initial={values({ source: "spoolmandb" })} onExit={onExit} />);
    await settle();

    await press(stdin, ENTER);
    await vi.waitFor(() => expect(lastFrame()).toContain("9 match"));
    await press(stdin, ENTER);
    await vi.waitFor(() => expect(lastFrame()).toContain("Select filaments with tab"));

    await press(stdin, ESC);
    await vi.waitFor(() => expect(lastFrame()).toContain("Printer preset"));
  });

  it("goes back from the plan to the picker and keeps the selection", async () => {
    const { lastFrame, stdin } = render(<App initial={values({ source: "spoolmandb" })} onExit={onExit} />);
    await settle();

    await press(stdin, ENTER);
    await vi.waitFor(() => expect(lastFrame()).toContain("9 match"));
    await press(stdin, TAB, ENTER);
    await vi.waitFor(() => expect(lastFrame()).toContain("Empty spool weight"));
    await press(stdin, ENTER);
    await vi.waitFor(() => expect(lastFrame()).toContain("[a] apply"));
    await press(stdin, "b");

    await vi.waitFor(() => expect(lastFrame()).toContain("1 selected"));
  });

  describe("empty spool weights", () => {
    beforeEach(() => {
      server.spoolsCatalog = SPOOLS_CATALOG;
    });

    it("asks for a brand's weight among its SpoolEase catalog rows and applies it", async () => {
      const { lastFrame, stdin } = render(<App initial={values({ source: "spoolmandb", query: "polylite" })} onExit={onExit} />);
      await settle();

      await press(stdin, ENTER);
      await vi.waitFor(() => expect(lastFrame()).toContain("1 match"));
      await press(stdin, CTRL_A, ENTER);
      await vi.waitFor(() => expect(lastFrame()).toContain("Empty spool weight: Polymaker · brand 1 of 1"));
      const frame = lastFrame() ?? "";
      expect(frame).toContain("SpoolmanDB says 140 g");
      expect(frame).toContain("› PolyMaker - Cardboard - 137g");
      expect(frame).toContain("Polymaker PolyTerra PLA (Cardboard Spool) - 147g");
      expect(frame).not.toContain("Unspecified");

      await press(stdin, DOWN, ENTER);
      await vi.waitFor(() => expect(lastFrame()).toContain("[a] apply"));
      expect(lastFrame()).toContain("149 g");
      await press(stdin, "a");

      await vi.waitFor(() => expect(lastFrame()).toContain("Done: 1 written, 0 failed"));
      expect(server.spools[0]).toMatchObject({ brand: "Polymaker", weight_core: "149" });
    });

    it("takes a brand's only catalog row without asking", async () => {
      const { lastFrame, stdin } = render(<App initial={values({ source: "spoolmandb", query: "ratrig" })} onExit={onExit} />);
      await settle();

      await press(stdin, ENTER);
      await vi.waitFor(() => expect(lastFrame()).toContain("1 match"));
      await press(stdin, CTRL_A, ENTER);

      await vi.waitFor(() => expect(lastFrame()).toContain("[a] apply"));
      expect(lastFrame()).toContain("220 g");
    });

    it("offers SpoolmanDB's weight or unspecified for a brand the catalog doesn't list", async () => {
      const { lastFrame, stdin } = render(<App initial={values({ source: "spoolmandb", query: "3dhojor abs+" })} onExit={onExit} />);
      await settle();

      await press(stdin, ENTER);
      await vi.waitFor(() => expect(lastFrame()).toContain("1 match"));
      await press(stdin, CTRL_A, ENTER);
      await vi.waitFor(() => expect(lastFrame()).toContain("Not in SpoolEase's spool catalog"));
      expect(lastFrame()).toContain("› SpoolmanDB");
      expect(lastFrame()).toContain("169 g");

      await press(stdin, DOWN, ENTER);
      await vi.waitFor(() => expect(lastFrame()).toContain("[a] apply"));
      await press(stdin, "a");

      await vi.waitFor(() => expect(lastFrame()).toContain("Done: 1 written, 0 failed"));
      expect(server.spools[0]).toMatchObject({ brand: "3DHoJor", weight_core: "" });
    });

    it("goes back from the weight menu to the picker with escape, and remembers the choice", async () => {
      const { lastFrame, stdin } = render(<App initial={values({ source: "spoolmandb", query: "polylite" })} onExit={onExit} />);
      await settle();

      await press(stdin, ENTER);
      await vi.waitFor(() => expect(lastFrame()).toContain("1 match"));
      await press(stdin, CTRL_A, ENTER);
      await vi.waitFor(() => expect(lastFrame()).toContain("Empty spool weight"));
      await press(stdin, DOWN, DOWN, ENTER);
      await vi.waitFor(() => expect(lastFrame()).toContain("[a] apply"));
      await press(stdin, "b");
      await vi.waitFor(() => expect(lastFrame()).toContain("1 selected"));
      await press(stdin, ENTER);

      await vi.waitFor(() => expect(lastFrame()).toContain("› PolyMaker - Plastic - 220g"));
      await press(stdin, ESC);
      await vi.waitFor(() => expect(lastFrame()).toContain("1 selected"));
    });

    it("shows a rejected SpoolEase key on the form before the plan", async () => {
      const { lastFrame, stdin } = render(<App initial={values({ securityKey: "WRONG" })} onExit={onExit} />);
      await settle();

      await press(stdin, ENTER);

      await vi.waitFor(() => expect(lastFrame()).toContain("SpoolEase key validation failed"));
      expect(lastFrame()).toContain("Printer preset");
    });

    it("warns and keeps the source's weights when the catalog can't be read", async () => {
      server.replies["GET /spools-catalog"] = { status: 404, body: "not found" };
      const { lastFrame, stdin } = render(<App initial={values({ source: "spoolmandb", query: "ratrig" })} onExit={onExit} />);
      await settle();

      await press(stdin, ENTER);
      await vi.waitFor(() => expect(lastFrame()).toContain("1 match"));
      await press(stdin, CTRL_A, ENTER);

      await vi.waitFor(() => expect(lastFrame()).toContain("Couldn't read the spool catalog from SpoolEase: HTTP 404: not found"));
      expect(lastFrame()).toContain("Empty spool weight: RatRig");
    });
  });

  it("shows SpoolmanDB download errors on the form", async () => {
    spoolmanDb.failWith = 503;
    const { lastFrame, stdin } = render(<App initial={values({ source: "spoolmandb" })} onExit={onExit} />);
    await settle();

    await press(stdin, ENTER);

    await vi.waitFor(() => expect(lastFrame()).toContain("HTTP 503"));
    expect(lastFrame()).toContain("Printer preset");
  });

  it("writes one preset per comma-separated printer", async () => {
    const { lastFrame, stdin } = render(<App initial={values({ skipSpoolease: true, printerPreset: `${X1C_04}, ${X1C_06}` })} onExit={onExit} />);
    await settle();

    await press(stdin, ENTER);
    await vi.waitFor(() => expect(lastFrame()).toContain("[a] apply"));
    await press(stdin, "a");

    await vi.waitFor(() => expect(lastFrame()).toContain("Done: 3 written, 0 failed"));
    expect(await readdir(baseFilamentDir(home))).toHaveLength(6);
  });

  it("shows setup errors such as an unknown printer and exits 2", async () => {
    const { lastFrame, stdin } = render(<App initial={values({ skipSpoolease: true, printerPreset: "Bambu Lab X1C 0.4 nozzle" })} onExit={onExit} />);
    await settle();

    await press(stdin, ENTER);
    await vi.waitFor(() => expect(lastFrame()).toContain("[a] apply"));
    await press(stdin, "a");

    await vi.waitFor(() => expect(lastFrame()).toContain('unknown BambuStudio printer "Bambu Lab X1C 0.4 nozzle"'));
    await press(stdin, "q");
    expect(onExit).toHaveBeenCalledWith(2);
  });
});
