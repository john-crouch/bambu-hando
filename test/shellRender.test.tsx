// ABOUTME: Render tests of the whole shell at 80x24 and 120x36: frame, header status, footer, overlays, banner, toast.
// ABOUTME: Uses ink-testing-library with the terminal size set on its stdout, and injected loaders instead of a console.

import { render } from "ink-testing-library";
import stringWidth from "string-width";
import { afterEach, describe, expect, it, vi } from "vitest";
import { placeholder } from "../src/tui/app/registry.js";
import type { Loaders } from "../src/tui/app/resources.js";
import { Shell } from "../src/tui/app/Shell.js";
import type { FormValues } from "../src/tui/core/values.js";
import { values } from "./shellFixtures.js";

const ESC = "\u001B";
const CTRL_K = "\u000B";

// biome-ignore lint/suspicious/noControlCharactersInRegex: strips the escape sequences colors use.
const ANSI = /\u001B\[[0-9;?]*[ -/]*[@-~]|\u001B\][^\u0007]*\u0007/g;

function loaders(overrides: Partial<Loaders> = {}): Loaders {
  return {
    console: () => Promise.resolve({ spools: [], filaments: new Map() }),
    presets: () => Promise.resolve({ presets: [], warnings: [] }),
    catalog: () => Promise.resolve({ profiles: [], warnings: [] }),
    check: () => Promise.resolve({ sections: [], warnings: [], presets: [] }),
    ...overrides,
  };
}

/** Title-only tabs, so these tests cover the shell whatever the real tabs draw. */
const PLACEHOLDER_TABS = {
  spools: placeholder("spools", "Spools"),
  add: placeholder("add", "Add"),
  presets: placeholder("presets", "Presets"),
  check: placeholder("check", "Check"),
  settings: placeholder("settings", "Settings"),
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

async function shellAt(
  columns: number,
  rows: number,
  options: { values?: Partial<FormValues>; loaders?: Partial<Loaders> } = {},
) {
  const onExit = vi.fn();
  const app = render(
    <Shell
      initial={values(options.values)}
      start={{ query: "" }}
      deps={{ tabs: PLACEHOLDER_TABS, loaders: loaders(options.loaders), now: () => 0 }}
      onExit={onExit}
    />,
  );
  Object.defineProperty(app.stdout, "columns", { value: columns, configurable: true });
  Object.defineProperty(app.stdout, "rows", { value: rows, configurable: true });
  app.stdout.emit("resize");
  const screen = () => (app.lastFrame() ?? "").replace(ANSI, "");
  // The shell hears of the size in an effect: wait for a frame drawn at it.
  await vi.waitFor(() => {
    const lines = screen().split("\n");
    expect(lines).toHaveLength(rows);
    expect(lines[rows - 1]).toContain("? help");
  });
  const press = async (...keys: string[]) => {
    for (const key of keys) {
      app.stdin.write(key);
      await settle();
    }
  };
  return { app, screen, press, onExit };
}

function expectFits(screen: string, columns: number, rows: number): void {
  const lines = screen.split("\n");
  expect(lines).toHaveLength(rows);
  for (const line of lines) expect(stringWidth(line)).toBeLessThanOrEqual(columns);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each([
  [80, 24],
  [120, 36],
])("shell at %ix%i", (columns, rows) => {
  it("fills the terminal with header, tab and footer", async () => {
    const { screen, app } = await shellAt(columns, rows);
    await vi.waitFor(() => expect(screen()).toContain("✓ SpoolEase 10.0.0.5"));
    const text = screen();
    const lines = text.split("\n");
    expect(lines[0]).toContain("bambu-hando");
    expect(lines[0]).toContain("Spools  Add  Presets  Check  Settings");
    expect(text).toContain("Coming soon");
    expect(lines[rows - 1]).toContain("tab next tab");
    expect(lines[rows - 1]).toContain("? help");
    expectFits(text, columns, rows);
    app.unmount();
  });

  it("draws help and the palette over the body, inside the terminal", async () => {
    const { screen, press, app } = await shellAt(columns, rows);
    await press("?");
    await vi.waitFor(() => expect(screen()).toContain("Help · Spools"));
    expect(screen()).toContain("Everywhere");
    expectFits(screen(), columns, rows);
    await press("x", CTRL_K);
    await vi.waitFor(() => expect(screen()).toContain("Type to find a command"));
    expect(screen()).toContain("Go to Settings");
    expectFits(screen(), columns, rows);
    await press("s", "e", "t");
    await vi.waitFor(() => expect(screen()).toContain("› set"));
    expect(screen()).not.toContain("Go to Add");
    await press("\r");
    await vi.waitFor(() => expect(screen()).toContain("Settings\n"));
    app.unmount();
  });
});

describe("shell", () => {
  it("switches tabs with tab and keeps the header's active tab in step", async () => {
    const { screen, press, app } = await shellAt(80, 24);
    await press("\t");
    await vi.waitFor(() => expect(screen()).toMatch(/\n\s+Add\n\s+Coming soon/));
    await press(`${ESC}[Z`);
    await vi.waitFor(() => expect(screen()).toMatch(/\n\s+Spools\n\s+Coming soon/));
    app.unmount();
  });

  it("shows a console that can't be reached, and lands on Add without one", async () => {
    const failing = await shellAt(80, 24, {
      loaders: { console: () => Promise.reject(new Error("SpoolEase key validation failed")) },
    });
    await vi.waitFor(() => expect(failing.screen()).toContain("✗ SpoolEase 10.0.0.5"));
    failing.app.unmount();

    const skipped = await shellAt(80, 24, { values: { skipSpoolease: true } });
    await vi.waitFor(() => expect(skipped.screen()).toContain("- SpoolEase skipped"));
    expect(skipped.screen()).toMatch(/\n\s+Add\n\s+Coming soon/);
    skipped.app.unmount();
  });

  it("drops the printer, then the console's name, from the header when narrow", async () => {
    const short = await shellAt(80, 24, { values: { host: "console.local" } });
    await vi.waitFor(() => expect(short.screen()).toContain("✓ SpoolEase console.local"));
    expect(short.screen().split("\n")[0]).not.toContain("X1C");
    short.app.unmount();

    const long = await shellAt(80, 24, { values: { host: "printer-room-console.local" } });
    await vi.waitFor(() => expect(long.screen().split("\n")[0]).toMatch(/Settings\s+✓$/));
    long.app.unmount();
  });

  it("quits on q with exit 0", async () => {
    const { press, onExit, app } = await shellAt(80, 24);
    await press("q");
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledWith(0));
    app.unmount();
  });
});
