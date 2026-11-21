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

  it("says why the label printer list is short", () => {
    const text = screen(
      {
        ...on("labels", 2),
        labelPrinters: { state: "ready", value: [] },
        open: { kind: "list", field: "labelPrinter", cursor: 0 },
      },
      ctx,
    );
    expect(text).toContain("[✓] Don't print");
    expect(side(text, ctx, "labels")).toContain("No printers found (lpstat -e)");
  });
});
