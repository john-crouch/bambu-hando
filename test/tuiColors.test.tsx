// ABOUTME: Tests the colors of the TUI's status lines: the whole line in the status color, as on every other screen.
// ABOUTME: Forces color before Ink loads (imports are dynamic for that), then renders App against a local SpoolEase server.

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { FormValues } from "../src/tui/App.js";
import { installBambuStudio, X1C_04 } from "./bambuStudioSetup.js";
import { SOURCE_FIXTURE } from "./parity.js";
import {
  type SpoolEaseServer,
  startSpoolEaseServer,
  TEST_SECURITY_KEY,
} from "./spooleaseServer.js";

const ENTER = "\r";
const RED = "\u001B[31m";
const GREEN = "\u001B[32m";
const YELLOW = "\u001B[33m";
const BLACK = "\u001B[30m";
const BRIGHT_WHITE = "\u001B[97m";

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

/** Whether `text` is drawn in `color`: inside one run from that color's code to the next foreground reset. */
function coloredAs(frame: string, color: string, text: string): boolean {
  return frame
    .split(color)
    .slice(1)
    .some((run) => run.split("\u001B[39m")[0]?.includes(text));
}

let ui: {
  render: typeof import("ink-testing-library").render;
  App: typeof import("../src/tui/App.js").App;
  ThemeProvider: typeof import("@inkjs/ui").ThemeProvider;
  theme: typeof import("../src/tui/theme.js").theme;
  PlanTable: typeof import("../src/tui/PlanTable.js").PlanTable;
};

beforeAll(async () => {
  // chalk reads the color level once, when it is first imported.
  process.env.FORCE_COLOR = "1";
  const [{ render }, { App }, { ThemeProvider }, { theme }, { PlanTable }] = await Promise.all([
    import("ink-testing-library"),
    import("../src/tui/App.js"),
    import("@inkjs/ui"),
    import("../src/tui/theme.js"),
    import("../src/tui/PlanTable.js"),
  ]);
  ui = { render, App, ThemeProvider, theme, PlanTable };
});

describe("TUI status line colors", () => {
  let server: SpoolEaseServer;
  let onExit: ReturnType<typeof vi.fn<(code: number) => void>>;

  beforeEach(async () => {
    const home = await mkdtemp(join(tmpdir(), "bambu-hando-tui-colors-"));
    vi.stubEnv("HOME", home);
    await installBambuStudio(home);
    vi.stubEnv("XDG_CACHE_HOME", undefined);
    vi.stubEnv("XDG_CONFIG_HOME", undefined);
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
      printerPreset: X1C_04,
      host: "127.0.0.1",
      port: String(server.port),
      securityKey: TEST_SECURITY_KEY,
      https: false,
      skipSpoolease: false,
      createSpools: false,
      overwritePresets: false,
      query: "",
      diameter: 1.75,
      ...overrides,
    };
  }

  async function apply(initial: FormValues): Promise<() => string> {
    const { App, ThemeProvider, theme, render } = ui;
    const { lastFrame, stdin } = render(
      <ThemeProvider theme={theme}>
        <App initial={initial} onExit={onExit} />
      </ThemeProvider>,
    );
    await settle();
    stdin.write(ENTER);
    await vi.waitFor(() => expect(lastFrame()).toContain("[a] apply"));
    await settle();
    stdin.write("a");
    return () => lastFrame() ?? "";
  }

  it("draws a clean run's done line green", async () => {
    const frame = await apply(values({ skipSpoolease: true }));

    await vi.waitFor(() => expect(frame()).toContain("Done: 3 written, 0 failed"));
    expect(coloredAs(frame(), GREEN, "Done: 3 written, 0 failed")).toBe(true);
  });

  it("draws warnings yellow and failed profiles red, the whole line", async () => {
    server.replies["POST /api/filaments-config"] = { status: 500, body: "boom" };
    const frame = await apply(values());

    await vi.waitFor(() => expect(frame()).toContain("Done: 0 written, 3 failed"));
    expect(coloredAs(frame(), YELLOW, "Failed to set custom filaments CSV: HTTP 500: boom")).toBe(
      true,
    );
    expect(coloredAs(frame(), RED, "PETG Red: custom filaments CSV: HTTP 500: boom")).toBe(true);
  });

  it("draws the error screen's message red", async () => {
    const frame = await apply(values({ securityKey: "WRONG" }));

    await vi.waitFor(() => expect(frame()).toContain("SpoolEase key validation failed"));
    expect(coloredAs(frame(), RED, "SpoolEase key validation failed")).toBe(true);
  });

  it("writes the gray SKIPPED badge in bright white, the colored ones in black", () => {
    const { render, ThemeProvider, theme, PlanTable } = ui;
    const profile = {
      name: "Acme PLA Black",
      brand: "Acme",
      material: "PLA",
      colorName: "Black",
      colorRgba: "000000FF",
      nozzleTempMin: 200,
      nozzleTempMax: 220,
      density: 1.24,
      diameter: 1.75,
      slicerFilamentCode: "",
      filamentId: "P1234567",
      labelWeight: 1000,
      coreWeight: 0,
    };
    const { lastFrame } = render(
      <ThemeProvider theme={theme}>
        <PlanTable
          profiles={[profile]}
          progress={[{ preset: "written", spool: "skipped" }]}
          activePresets={false}
          activeSpools={false}
        />
      </ThemeProvider>,
    );

    const frame = lastFrame() ?? "";
    expect(coloredAs(frame, BRIGHT_WHITE, "SKIPPED")).toBe(true);
    expect(coloredAs(frame, BLACK, "WRITTEN")).toBe(true);
  });
});
