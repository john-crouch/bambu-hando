// ABOUTME: Render tests of the whole shell at 80x24 and 120x36: frame, header status, footer, overlays, banner, toast.
// ABOUTME: Uses ink-testing-library with the terminal size set on its stdout, and injected loaders instead of a console.

import { Text } from "ink";
import { render } from "ink-testing-library";
import stringWidth from "string-width";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  // Colors on, so the toast's bar and the backdrop's dimming are in the frames.
  process.env.FORCE_COLOR = "3";
});

import { type AnyTab, placeholder } from "../src/tui/app/registry.js";
import type { Loaders } from "../src/tui/app/resources.js";
import { Shell } from "../src/tui/app/Shell.js";
import type { KeyPress } from "../src/tui/core/keys.js";
import type { AppMsg, Step, TabId, TabModule, TabMsg } from "../src/tui/core/types.js";
import type { FormValues } from "../src/tui/core/values.js";
import { Dialog } from "../src/tui/ui/Dialog.js";
import { Line } from "../src/tui/ui/Line.js";
import { COLORS } from "../src/tui/ui/theme.js";
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

interface DialogModel {
  open: boolean;
}

function BodyText() {
  return <Line segments={[{ text: "Body text", color: COLORS.ok }]} width={80} />;
}

/** A tab with a dialog of its own: d opens it, esc closes it. */
const DIALOG_TAB: TabModule<DialogModel> = {
  id: "spools",
  title: "Spools",
  init: () => [{ open: false }, []],
  update(model, msg) {
    const key = msg.type === "key" ? (msg.key as KeyPress) : null;
    if (key?.input === "d") return [{ open: true }, []];
    if (key?.name === "esc") return [{ open: false }, []];
    return [model, []];
  },
  View: BodyText,
  capturesText: () => false,
  modal: (model) => model.open,
  dialog: (model) =>
    model.open ? (
      <Dialog title="Scan a barcode" width={40}>
        <Text>Barcode</Text>
      </Dialog>
    ) : null,
  hints: (model) =>
    model.open ? [{ keys: "esc", label: "close" }] : [{ keys: "d", label: "dialog" }],
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

async function shellAt(
  columns: number,
  rows: number,
  options: {
    values?: Partial<FormValues>;
    loaders?: Partial<Loaders>;
    tabs?: Partial<Record<TabId, AnyTab>>;
  } = {},
) {
  const onExit = vi.fn();
  const app = render(
    <Shell
      initial={values(options.values)}
      start={{ query: "" }}
      deps={{
        tabs: { ...PLACEHOLDER_TABS, ...options.tabs },
        loaders: loaders(options.loaders),
        now: () => 0,
      }}
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
    // ink-testing-library reports 100 columns until the resize lands: wait for a frame drawn at ours.
    for (const line of lines) expect(stringWidth(line)).toBeLessThanOrEqual(columns);
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

  it("draws a toast over the body's last line and keeps every footer key", async () => {
    const spools = placeholder("spools", "Spools");
    const toasting = {
      ...spools,
      update: (model: { title: string }, msg: AppMsg | TabMsg) =>
        [
          model,
          msg.type === "key" && (msg.key as KeyPress).input === "!"
            ? [(dispatch: (m: AppMsg) => void) => dispatch({ type: "app/toast", text: "3 saved" })]
            : [],
        ] as Step<{ title: string }>,
      hints: () => [
        { keys: "↑↓", label: "move", primary: true },
        { keys: "space", label: "tick" },
        { keys: "s", label: "sort" },
      ],
    };
    const { screen, press, app } = await shellAt(80, 24, { tabs: { spools: toasting } });
    const footer = () => screen().split("\n")[23] ?? "";
    const before = footer();
    await press("!");
    // The toast's row is only the toast: nothing of the body's last line shows beside it.
    await vi.waitFor(() => expect(screen().split("\n")[22]).toMatch(/^ ✓ 3 saved {60,}$/));
    expect(footer()).toBe(before);
    expect(footer()).toContain("space tick  s sort");
    app.unmount();
  });

  it("draws a tab's dialog centered over its dimmed body, and nothing of it once closed", async () => {
    const { screen, press, app } = await shellAt(80, 24, { tabs: { spools: DIALOG_TAB } });
    const bodyLine = () =>
      (app.lastFrame() ?? "").split("\n").find((line) => line.includes("Body text")) ?? "";
    await vi.waitFor(() => expect(screen()).toContain("Body text"));
    expect(bodyLine()).not.toContain("\u001B[2m");
    await press("d");
    await vi.waitFor(() => expect(screen()).toContain("╭ Scan a barcode"));
    const top = screen()
      .split("\n")
      .findIndex((line) => line.includes("╭ Scan a barcode"));
    expect(screen().split("\n")[top]?.indexOf("╭")).toBe(20);
    expect(bodyLine()).toContain("\u001B[2m");
    expect(screen().split("\n")[23]?.trim()).toBe("esc close");
    await press(ESC);
    await vi.waitFor(() => expect(screen()).not.toContain("Scan a barcode"));
    expect(bodyLine()).not.toContain("\u001B[2m");
    app.unmount();
  });

  it("quits on q with exit 0", async () => {
    const { press, onExit, app } = await shellAt(80, 24);
    await press("q");
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledWith(0));
    app.unmount();
  });
});
