// ABOUTME: Renders the Spools tab and the labels overlay at 80x24 and 120x36: every state, every dialog, exact widths.
// ABOUTME: The body is drawn as the shell gives it (terminal less header and footer), line by line in whole columns.

import { stripVTControlCharacters } from "node:util";
import { ThemeProvider } from "@inkjs/ui";
import { renderToString } from "ink";
import { describe, expect, it } from "vitest";

import { DEFAULT_LABEL_SETTINGS } from "../src/labelSettings.js";
import { LABEL_FIELDS } from "../src/labels.js";
import { press } from "../src/tui/core/keys.js";
import type { Ctx, Resources } from "../src/tui/core/types.js";
import type { FormValues } from "../src/tui/core/values.js";
import { labelsOverlay } from "../src/tui/overlays/labels/index.js";
import { type LabelsModel, MAKE_ROW, PRINTER_ROW } from "../src/tui/overlays/labels/model.js";
import { spoolsTab } from "../src/tui/tabs/spools/index.js";
import type { SpoolsModel } from "../src/tui/tabs/spools/model.js";
import { frameBody, textWidth, theme } from "../src/tui/ui/index.js";
import { consoleOf, makeCtx, spool } from "./tabSpoolsFixtures.js";

const SPOOLS = [
  spool({
    id: "14",
    brand: "Sunlu",
    material: "PETG",
    colorName: "2.0 Vivid Yellow",
    colorCodes: ["F1C400FF"],
    currentWeight: 800,
    coreWeight: 236,
    location: "AMS 1 · slot 2",
    addedTime: Date.UTC(2026, 9, 30, 12) / 1000,
    slicerFilament: "P4840583",
  }),
  spool({
    id: "13",
    colorName: "Basic White",
    colorCodes: ["FFFFFFFF"],
    currentWeight: 320,
    slicerFilament: "P5555555",
  }),
  spool({
    id: "12",
    colorName: "Black",
    colorCodes: ["000000FF"],
    currentWeight: 260,
    slicerFilament: "P6666666",
  }),
  spool({ id: "3", slicerFilament: "", brand: "Mystery", material: "ABS", colorName: "Gray" }),
];

const FILAMENTS = new Map([
  ["P4840583", { name: "Sunlu PETG 2.0 Vivid Yellow", nozzleTempMin: 230, nozzleTempMax: 250 }],
]);

const READY = {
  console: consoleOf(SPOOLS, FILAMENTS),
  check: { state: "ready" as const, value: { sections: [], warnings: [], presets: [] }, at: 0 },
};

function ctxAt(
  columns: number,
  rows: number,
  overrides: { values?: Partial<FormValues>; resources?: Partial<Resources> } = {},
): Ctx {
  const body = frameBody(columns, rows);
  return {
    ...makeCtx({ resources: READY, ...overrides }),
    columns,
    rows,
    bodyColumns: body.columns,
    bodyRows: body.rows,
  };
}

function draw(element: React.ReactElement, columns: number): string[] {
  const out = renderToString(<ThemeProvider theme={theme}>{element}</ThemeProvider>, { columns });
  return stripVTControlCharacters(out).split("\n");
}

function tab(model: SpoolsModel, ctx: Ctx): string[] {
  return draw(<spoolsTab.View model={model} ctx={ctx} />, ctx.bodyColumns);
}

function start(ctx: Ctx): SpoolsModel {
  return spoolsTab.init(ctx, { query: "" })[0];
}

function keys(model: SpoolsModel, ctx: Ctx, ...what: string[]): SpoolsModel {
  return what.reduce((m, k) => spoolsTab.update(m, { type: "key", key: press(k) }, ctx)[0], model);
}

/** The body fills the tab's area exactly: as many lines as rows, each exactly as wide as the terminal. */
function expectExact(lines: string[], ctx: Ctx): void {
  expect(lines).toHaveLength(ctx.bodyRows);
  for (const [index, line] of lines.entries())
    expect(textWidth(line), `line ${index}: ${line}`).toBe(ctx.bodyColumns);
}

const SIZES: [number, number][] = [
  [60, 20],
  [80, 24],
  [120, 36],
];

describe.each(SIZES)("the Spools tab at %ix%i", (columns, rows) => {
  const ctx = ctxAt(columns, rows);

  it("lists the spools with the summary, exactly filling the body", () => {
    const lines = tab(start(ctx), ctx);
    expectExact(lines, ctx);
    expect(lines[0]).toContain("Spools · newest first");
    // A short line leaves out the least useful part whole.
    expect(lines[1]).toContain(
      columns < 80
        ? "4 spools · 744 g left · 2 low · ✓ in sync"
        : "4 spools · 744 g left · 2 low · 1 not weighed · ✓ in sync",
    );
    const text = lines.join("\n");
    expect(text).toContain("#14");
    expect(text).toContain("Sunlu PETG 2.0 Vivid Yellow");
    expect(text).toContain("564 g");
    expect(text).toContain("▰▰▰▰▰▰▱▱▱▱");
    expect(text).toMatch(/╰─+ 1\/4 ─╯/);
  });

  it("shows the filter and its matches", () => {
    const model = keys(start(ctx), ctx, "/", "white");
    const lines = tab(model, ctx);
    expectExact(lines, ctx);
    expect(lines[0]).toContain("1 of 4 · newest first");
    expect(lines[2]).toContain("/ white");
    expect(lines.join("\n")).not.toContain("Vivid Yellow");
    const none = tab(keys(start(ctx), ctx, "/", "nothing"), ctx);
    expect(none.join("\n")).toContain("No spool matches every word of the filter.");
  });

  it.each([
    [{ values: { skipSpoolease: true } }, "SpoolEase is skipped", "enter open Settings"],
    [{ values: { host: "" } }, "No SpoolEase console set up", "enter open Settings"],
    [
      { resources: { console: { state: "failed" as const, error: "connection refused" } } },
      "Couldn't read the console's spools",
      "enter open Settings",
    ],
    [{ resources: { console: consoleOf([]) } }, "No spools on the console yet", "enter add spools"],
  ])("explains an empty state (%#)", (overrides, title, action) => {
    const empty = ctxAt(columns, rows, overrides);
    const lines = tab(start(empty), empty);
    expectExact(lines, empty);
    const text = lines.join("\n");
    expect(text).toContain(title);
    expect(text).toContain(action);
  });

  it("shows the reading state with the console's address and never the key", () => {
    const loading = ctxAt(columns, rows, { resources: { console: { state: "loading" } } });
    const text = tab(start(loading), loading).join("\n");
    expect(text).toContain("Reading spools from http://127.0.0.1…");
    expect(text).not.toContain("SECRETKEY");
  });

  it("draws the count dialog over the list, naming the console and the spool copied", () => {
    const model = keys(start(ctx), ctx, "+", "up");
    const lines = tab(model, ctx);
    expectExact(lines, ctx);
    const text = lines.join("\n");
    expect(text).toContain("More spools like this one");
    expect(text).toContain("Copies of spool #14 go to http://127.0.0.1");
    expect(text).toContain("‹ 2 ›  new spools");
    expect(text).toContain("The console has 1 spool of this filament.");
    // Its keys are in the footer, not repeated in the dialog.
    expect(text).not.toContain("add 2 spools");
    expect(text).not.toContain("SECRETKEY");
  });

  it("streams results into the count dialog and offers labels when done", () => {
    let model = keys(start(ctx), ctx, "+", "up", "a");
    const run = model.dialog?.kind === "count" ? model.dialog.run : 0;
    model = spoolsTab.update(
      model,
      { type: "spools/copy", run, result: { ok: true, id: "15" } },
      ctx,
    )[0];
    expect(tab(model, ctx).join("\n")).toContain("✓ spool #15 added");
    model = spoolsTab.update(
      model,
      {
        type: "spools/copiesDone",
        run,
        results: [
          { ok: true, id: "15" },
          { ok: false, error: "storage full" },
        ],
        error: "",
      },
      ctx,
    )[0];
    const text = tab(model, ctx).join("\n");
    expect(text).toContain("✗ spool 2 of 2: storage full");
    expect(text).toContain("1 added · 1 failed");
    expect(text).not.toContain("labels for 1 new spool");
  });

  it("draws the scan, known-barcode and choose dialogs", () => {
    const barcodes = new Map([["0015", { code: "P4840583", name: "Sunlu PETG 2.0 Vivid Yellow" }]]);
    const scan = spoolsTab.update(
      keys(start(ctx), ctx, "b"),
      { type: "spools/barcodes", barcodes },
      ctx,
    )[0];
    let text = tab(keys(scan, ctx, "00"), ctx).join("\n");
    expect(text).toContain("Scan a barcode");
    expect(text).not.toContain("Scan the spool's barcode");
    expect(text).toContain("Barcode  00");
    expect(text).toContain("1 known so far");
    text = tab(keys(scan, ctx, "0015\r"), ctx).join("\n");
    expect(text).toContain("Barcode 0015");
    expect(text).toContain("this barcode is");
    expect(text).toContain("Sunlu PETG 2.0 Vivid Yellow");
    expect(text).toContain("More spools of it");
    expect(text).toContain("A different filament");
    const choose = tab(keys(scan, ctx, "NEW\r"), ctx);
    expectExact(choose, ctx);
    expect(choose.join("\n")).toContain("Which filament is NEW?");
    expect(choose.join("\n")).not.toContain("which filament is it");
    expect(choose.join("\n")).toContain("Acme PETG Basic White");
    expect(choose.join("\n")).toMatch(/Other… +find it in Add/);
  });

  it("says empty, in place of a bar, for a spool with nothing left", () => {
    const emptied = ctxAt(columns, rows, {
      resources: {
        console: consoleOf([...SPOOLS, spool({ id: "20", currentWeight: 200 })], FILAMENTS),
      },
    });
    const lines = tab(start(emptied), emptied);
    expectExact(lines, emptied);
    // The list's part of the line: the detail beside it at 120 has a bar of its own.
    const row = (lines.find((line) => line.includes("] ") && line.includes("#20")) ?? "").split(
      "││",
    )[0];
    expect(row, lines.join("\n")).toMatch(/empty\s*(│|┃|$)/);
    expect(row, lines.join("\n")).not.toContain("▱");
  });

  if (columns < 90)
    it("keeps a compact detail of the highlighted spool under the list", () => {
      const lines = tab(start(ctx), ctx);
      expectExact(lines, ctx);
      const text = lines.join("\n");
      expect(text).toContain("╭ #14 Sunlu PETG 2.0 Vivid Yellow");
      expect(text).toContain("564 g of 1000 g · 56% · 236 g spool");
      expect(text).toContain("AMS 1 · slot 2");
      // The list still shows the rest of the spools.
      expect(text).toContain("#3 ");
    });

  it(
    columns < 90 ? "opens the detail in place of the list" : "shows the detail beside the list",
    () => {
      const model = columns < 90 ? keys(start(ctx), ctx, "enter") : start(ctx);
      const lines = tab(model, ctx);
      expectExact(lines, ctx);
      const text = lines.join("\n");
      expect(text).toContain("╭ #14");
      expect(text).toContain("Left      564 g of 1000 g · 56%");
      expect(text).toContain("Empty     236 g spool");
      expect(text).toContain("Location  AMS 1 · slot 2");
      expect(text).toContain("Nozzle    230–250°C");
      expect(text).toContain("Added     2026-10-30");
    },
  );
});

describe.each(SIZES)("the labels overlay at %ix%i", (columns, rows) => {
  const ctx = ctxAt(columns, rows);

  function overlay(model: LabelsModel): string[] {
    return draw(<labelsOverlay.View model={model} ctx={ctx} />, ctx.bodyColumns);
  }

  function loaded(): LabelsModel {
    const [model] = labelsOverlay.init({ spoolIds: ["14", "13"], fresh: true }, ctx);
    return labelsOverlay.update(
      model,
      {
        type: "labels/loaded",
        settings: { ...DEFAULT_LABEL_SETTINGS, printer: "DYMO" },
        printers: ["DYMO"],
      },
      ctx,
    )[0];
  }

  it("fits the body and shows the fields, the preview and what Make labels does", () => {
    const lines = overlay(loaded());
    expect(lines.length).toBeLessThanOrEqual(ctx.bodyRows);
    for (const line of lines) expect(textWidth(line)).toBeLessThanOrEqual(ctx.bodyColumns);
    const text = lines.join("\n");
    expect(text).toContain("Labels for 2 new spools");
    expect(text).toContain("[✓] qr");
    expect(text).toContain("[ ] location");
    expect(text).toContain("╭ #14");
    expect(text).toContain("Sunlu");
    expect(text).toMatch(/230–250 ?°C/);
    expect(text).toContain("Print 2 labels on DYMO");
    // Its keys are in the footer.
    expect(text).not.toContain("esc close");
  });

  it("says once what's missing, on the Make row", () => {
    const model = labelsOverlay.update(
      { ...loaded(), printer: "", focus: MAKE_ROW },
      { type: "key", key: press("enter") },
      ctx,
    )[0];
    const text = overlay(model).join("\n");
    expect(text.split("Choose a printer, a PDF path, or both")).toHaveLength(2);
    expect(text).not.toContain("✗");
    const [loading] = labelsOverlay.init({ spoolIds: ["14"], fresh: false }, ctx);
    expect(overlay(loading).join("\n")).toContain("Looking for printers…");
  });

  it("keeps the dialog's height when fields are ticked or unticked", () => {
    const many = { ...loaded(), fields: LABEL_FIELDS.map((f) => f.key) };
    const few = { ...loaded(), fields: ["brand" as const] };
    expect(overlay(many)).toHaveLength(overlay(few).length);
    expect(overlay(many).join("\n")).toMatch(/\+\d+ more/);
  });

  it("opens the printer choices as a list, Don't print first", () => {
    const model = labelsOverlay.update(
      { ...loaded(), focus: PRINTER_ROW },
      { type: "key", key: press("enter") },
      ctx,
    )[0];
    const text = overlay(model).join("\n");
    expect(text).toContain("Labels for 2 new spools · Printer");
    expect(text).toContain("Don't print");
    expect(text).toContain("DYMO");
  });
});
