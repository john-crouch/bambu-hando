// ABOUTME: Renders the Settings tab's view at 80x24 and 120x36: every page, an open list, a text field, the test result.
// ABOUTME: Asserts each screen fits the body exactly and never shows the security key; SNAP=1 prints the screens.

import { stripVTControlCharacters } from "node:util";
import { ThemeProvider } from "@inkjs/ui";
import { renderToString } from "ink";
import { describe, expect, it } from "vitest";

import { DEFAULT_LABEL_SETTINGS } from "../src/labelSettings.js";
import type { Ctx } from "../src/tui/core/types.js";
import type { FormValues } from "../src/tui/core/values.js";
import { settingsTab } from "../src/tui/tabs/settings/index.js";
import { settingsLayout } from "../src/tui/tabs/settings/layout.js";
import type { SettingsModel } from "../src/tui/tabs/settings/model.js";
import { textWidth, theme } from "../src/tui/ui/index.js";
import { ctxOf } from "./tabSettingsHarness.js";

const X1C = "Bambu Lab X1 Carbon 0.4 nozzle";
const VALUES: Partial<FormValues> = {
  host: "10.0.24.111",
  securityKey: "SECRETKEY",
  printerPreset: X1C,
  presetFolder: "1489686194",
};

const MODEL: SettingsModel = {
  page: "bambu",
  cursors: { bambu: 0, spoolease: 0, labels: 0, import: 0 },
  open: null,
  error: "",
  test: { state: "idle" },
  testSeq: 0,
  asked: true,
  folders: { state: "ready", value: ["1489686194", "default"] },
  printers: {
    state: "ready",
    value: Array.from(
      { length: 40 },
      (_, i) => `Bambu Lab Printer ${String(i).padStart(2, "0")} 0.4 nozzle`,
    ).concat(X1C),
  },
  labelPrinters: { state: "ready", value: ["Label-Printer", "Office-Laser"] },
  labels: { state: "ready", value: DEFAULT_LABEL_SETTINGS },
};

function sized(columns: number, rows: number, values: Partial<FormValues> = VALUES): Ctx {
  return { ...ctxOf(values), columns, rows, bodyColumns: columns, bodyRows: rows - 2 };
}

function screen(model: SettingsModel, ctx: Ctx): string {
  const out = renderToString(
    <ThemeProvider theme={theme}>
      <settingsTab.View model={model} ctx={ctx} />
    </ThemeProvider>,
    { columns: ctx.bodyColumns },
  );
  const lines = stripVTControlCharacters(out).split("\n");
  if (process.env.SNAP) console.log(lines.join("\n"));
  expect(lines).toHaveLength(ctx.bodyRows);
  for (const line of lines) expect(textWidth(line)).toBeLessThanOrEqual(ctx.bodyColumns);
  expect(lines.join("\n")).not.toContain("SECRETKEY");
  return lines.join("\n");
}

/** The detail panel's words in order (beside the rows, or under them), borders and breaks gone: for text it wraps. */
function side(text: string, ctx: Ctx, page: SettingsModel["page"] = "spoolease"): string {
  const layout = settingsLayout(ctx, page);
  const lines = text.split("\n");
  return (layout.stacked ? lines.slice(1 + layout.rowsHeight) : lines)
    .map((line) => (layout.stacked ? line : [...line].slice(layout.left).join("")))
    .join(" ")
    .replace(/[│╭╮╰╯]/g, " ")
    .replace(/\s+/g, " ");
}

describe.each([
  [60, 20],
  [80, 24],
  [120, 36],
])("the Settings tab at %ix%i", (columns, rows) => {
  const ctx = sized(columns, rows);
  const on = (page: SettingsModel["page"], cursor = 0): SettingsModel => ({
    ...MODEL,
    page,
    cursors: { ...MODEL.cursors, [page]: cursor },
  });

  it("shows the BambuStudio page with the pages above it", () => {
    const text = screen(MODEL, ctx);
    expect(text).toContain("▸ BambuStudio ─ SpoolEase ─ Labels ─ Import");
    expect(text).toContain("Preset folder      1489686194");
    expect(text).toContain("Overwrite presets  off");
    expect(side(text, ctx, "bambu")).toContain("BambuStudio's user folder the presets go in");
  });

  it("lists the ticked printers beside the Printers row", () => {
    expect(screen(on("bambu", 1), ctx)).toContain("✓ X1C 0.4");
  });

  it("shows an open printer list with its ticks and position", () => {
    const text = screen(
      { ...MODEL, open: { kind: "list", field: "printerPreset", cursor: 40 } },
      ctx,
    );
    expect(text).toContain("Printers · 1 ticked");
    expect(text).toContain("[✓] X1C 0.4");
    expect(text).toContain("41/41");
  });

  it("shows the SpoolEase page with the key as set, and the test's result", () => {
    const tested: SettingsModel = {
      ...on("spoolease"),
      test: { state: "ok", text: "http://10.0.24.111 accepts the key" },
    };
    const text = screen(tested, ctx);
    expect(text).toContain("Security key   set");
    expect(text).toContain("Create spools  ✓ on");
    expect(side(text, ctx)).toContain("✓ http://10.0.24.111 accepts the key");
    const failed = screen(
      { ...tested, test: { state: "failed", text: "http://10.0.24.111 rejects the security key" } },
      ctx,
    );
    expect(side(failed, ctx)).toContain("✗ http://10.0.24.111 rejects the security key");
    expect(screen({ ...tested, test: { state: "testing" } }, ctx)).toContain(
      "Testing the connection…",
    );
  });

  it("edits the key as dots", () => {
    const editing: SettingsModel = {
      ...on("spoolease", 2),
      open: { kind: "text", field: "securityKey", value: "SECRETKEY", cursor: 9 },
    };
    const text = screen(editing, ctx);
    expect(text).toContain("•••••••••");
    expect(side(text, ctx)).toContain("Typed as dots; never shown or logged.");
  });

  it("shows an inline error and a placeholder while typing", () => {
    const editing: SettingsModel = {
      ...on("spoolease", 1),
      open: { kind: "text", field: "port", value: "", cursor: 0 },
      error: "The port is a whole number from 1 to 65535",
    };
    const text = screen(editing, ctx);
    expect(side(text, ctx)).toContain("✗ The port is a whole number from 1 to 65535");
    const host = screen(
      { ...on("spoolease"), open: { kind: "text", field: "host", value: "", cursor: 0 } },
      ctx,
    );
    expect(host).toContain("e.g. 192.168.1.50");
  });

  it("marks a page that needs attention", () => {
    const text = screen(MODEL, sized(columns, rows, { ...VALUES, host: "" }));
    expect(text).toContain("SpoolEase !");
    const skipped = screen(
      on("spoolease"),
      sized(columns, rows, { ...VALUES, skipSpoolease: true }),
    );
    expect(skipped).not.toContain("SpoolEase !");
    expect(skipped).toContain("SpoolEase is skipped");
  });

  it("counts the label fields where their names don't fit, never cutting one", () => {
    const labels = screen(on("labels", 1), ctx);
    expect(labels).not.toMatch(/Fields .*…/);
    expect(labels).toMatch(/Fields +7 fields/);
  });

  it("shows the label settings and the import page", () => {
    const labels = screen(on("labels"), ctx);
    expect(labels).toContain("Size         57x32mm");
    expect(labels).toContain("✓ Color name");
    expect(labels).toContain("saved for next time");
    const imports = screen(on("import"), ctx);
    expect(imports).toContain("File or URL  none (SpoolmanDB only)");
    expect(imports).toContain("Diameter     1.75 mm");
  });

  it("never cuts a value while the explanation has room: it goes under the rows below 90 columns", () => {
    const text = screen(
      on("bambu", 1),
      sized(columns, rows, { ...VALUES, printerPreset: `${X1C}, Bambu Lab X1 Carbon 0.6 nozzle` }),
    );
    expect(text).toContain("X1C 0.4, 0.6");
    expect(text).toContain("1489686194");
    expect(text).not.toMatch(/14896…|X1C 0…/);
  });

  it("filters an open list, highlighting what matches", () => {
    const text = screen(
      {
        ...MODEL,
        open: {
          kind: "list",
          field: "printerPreset",
          cursor: 0,
          filter: { value: "x1", cursor: 2 },
          filtering: true,
        },
      },
      ctx,
    );
    expect(text).toContain("/ x1");
    expect(text).toContain("[✓] X1C 0.4");
    expect(text).not.toContain("Printer 00");
  });

  it("marks a one-of choice with a radio, and lines its list up with the rows", () => {
    const text = screen(
      { ...MODEL, open: { kind: "list", field: "presetFolder", cursor: 0 } },
      ctx,
    );
    expect(text).toContain("● 1489686194");
    expect(text).toContain("○ default");
    expect(text).not.toContain("[✓] 1489686194");
    const printers = screen(
      { ...on("labels", 2), open: { kind: "list", field: "labelPrinter", cursor: 0 } },
      ctx,
    );
    expect(printers).toContain("○ Label-Printer");
    const lines = text.split("\n");
    const row = lines.findIndex((line) => line.includes("Preset folder      1489686194"));
    const item = lines.findIndex((line) => line.includes("● 1489686194"));
    // Side by side, the chosen item sits on its row's line; stacked, it's in the panel under the rows.
    if (!settingsLayout(ctx, "bambu").stacked) expect(item).toBe(row);
  });

  it("dims what only matters with SpoolEase on: no ✓ while it's skipped", () => {
    const skipped = screen(
      on("spoolease"),
      sized(columns, rows, { ...VALUES, skipSpoolease: true }),
    );
    expect(skipped).toContain("Create spools  on");
    expect(skipped).not.toContain("Create spools  ✓ on");
    expect(skipped).toContain("Use SpoolEase  off");
  });

  it("says which settings last only this session and which are kept", () => {
    expect(screen(on("bambu", 0), ctx)).toContain("this session only");
    expect(screen(on("bambu", 1), ctx)).toContain("saved for next time");
    expect(screen(on("spoolease", 0), ctx)).toContain("saved for next time");
    expect(screen(on("spoolease", 2), ctx)).toContain("saved for next time");
    expect(screen(on("spoolease", 4), ctx)).toContain("this session only");
    expect(screen(on("labels", 0), ctx)).toContain("saved for next time");
    expect(screen(on("bambu", 0), ctx)).not.toContain("applies at once");
  });

  it("keeps a long path's file name in view", () => {
    const output = "/srv/share/printing/labels/archive/2026/november/spool-labels-final.pdf";
    const text = screen(
      {
        ...on("labels", 3),
        labels: { state: "ready", value: { ...DEFAULT_LABEL_SETTINGS, output } },
      },
      ctx,
    );
    expect(text).toMatch(/…\/(\S+\/)*spool-labels-final\.pdf/);
  });

  it("says the console answered its last read, before any test", () => {
    const base = sized(columns, rows);
    const read = {
      ...base,
      resources: {
        ...base.resources,
        console: { state: "ready" as const, value: { spools: [], filaments: new Map() }, at: 1 },
      },
    };
    expect(side(screen(on("spoolease"), read), read)).toContain(
      "✓ The console answered its last read",
    );
    expect(side(screen(on("spoolease"), base), base)).toContain("Not tested yet");
  });

  it("says what the console's last read found, and what to check", () => {
    const failed = {
      ...sized(columns, rows),
      resources: {
        ...sized(columns, rows).resources,
        console: { state: "failed" as const, error: "SpoolEase key validation failed" },
      },
    };
    const text = side(screen(on("spoolease", 2), failed), failed);
    expect(text).toContain("✗ SpoolEase key validation failed");
    expect(text).toContain("check the security key");
  });

  it("says why the label printer list is short", () => {
    const text = screen(
      {
        ...on("labels", 2),
        labelPrinters: { state: "ready", value: [] },
        open: { kind: "list", field: "labelPrinter", cursor: 0 },
      },
      ctx,
    );
    expect(text).toContain("● Don't print");
    expect(side(text, ctx, "labels")).toContain("No printers found (lpstat -e)");
  });
});
