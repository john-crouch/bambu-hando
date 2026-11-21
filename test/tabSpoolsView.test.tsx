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
import { Frame, frameBody, Line, textWidth, theme } from "../src/tui/ui/index.js";
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

/** The tab's body as the shell draws it: the View, with the tab's dialog (if any) on the layer above. */
function tab(model: SpoolsModel, ctx: Ctx): string[] {
  const lines = draw(
    <Frame
      columns={ctx.columns}
      rows={ctx.rows}
      header={<Line segments={[]} width={ctx.columns} />}
      footer={<Line segments={[]} width={ctx.columns} />}
      dialog={spoolsTab.dialog?.(model, ctx) ?? null}
    >
      <spoolsTab.View model={model} ctx={ctx} />
    </Frame>,
    ctx.columns,
  );
  return lines.slice(1, 1 + ctx.bodyRows);
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

/** A dialog's text as one line of words: what's inside its borders, over whatever it covers. */
function flat(lines: string[]): string {
  return lines
    .map((line) => {
      const inside = line.slice(1, -1);
      const first = inside.indexOf("│");
      const last = inside.lastIndexOf("│");
      return first >= 0 && last > first ? inside.slice(first + 1, last) : inside;
    })
    .join(" ")
    .replace(/\s+/g, " ");
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
    expect(lines[1]).toContain("4 spools · 744 g left · 2 low · 1 unweighed · ✓ in sync");
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
    // The spool copied is the filament's newest; prose wraps, so check it without the line breaks.
    const prose = flat(lines);
    expect(prose).toContain(
      "Copies of spool #14 (the newest spool of this filament) go to http://127.0.0.1",
    );
    expect(text).toContain("‹ 2 ›  new spools");
    expect(prose).toContain("The console has 1 spool of this filament.");
    // Its keys are in the footer, not repeated in the dialog.
    expect(text).not.toContain("add 2 spools");
    expect(text).not.toContain("SECRETKEY");
  });

  it("leaves its dialogs to the shell's dialog layer: the View itself never draws one", () => {
    const model = keys(start(ctx), ctx, "+");
    const view = draw(<spoolsTab.View model={model} ctx={ctx} />, ctx.bodyColumns).join("\n");
    expect(view).not.toContain("More spools like this one");
    expect(spoolsTab.dialog?.(start(ctx), ctx)).toBeNull();
    expect(tab(model, ctx).join("\n")).toContain("More spools like this one");
  });

  it("streams results into the count dialog and offers labels when done", () => {
    let model = keys(start(ctx), ctx, "+", "up", "a");
    const run = model.dialog?.kind === "count" ? model.dialog.run : 0;
    model = spoolsTab.update(
      model,
      { type: "spools/copy", run, result: { ok: true, id: "15" } },
      ctx,
    )[0];
    expect(tab(model, ctx).join("\n")).toContain("Adding spool 2 of 2…");
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
    const lines = tab(model, ctx);
    expectExact(lines, ctx);
    const text = lines.join("\n");
    // One outcome line, then why the failed one failed; the pre-write prose and count are gone.
    expect(text).toContain("! 1 of 2 spools added: #15");
    expect(text).toContain("✗ spool 2: storage full");
    expect(text).toContain("More spools like this one");
    expect(text).not.toContain("Added ");
    expect(text).not.toContain("The console has");
    expect(text).not.toContain("labels for 1 new spool");
  });

  it("says a clean run in one line", () => {
    let model = keys(start(ctx), ctx, "+", "up", "a");
    const run = model.dialog?.kind === "count" ? model.dialog.run : 0;
    const results = [
      { ok: true, id: "15" },
      { ok: true, id: "16" },
    ];
    model = spoolsTab.update(model, { type: "spools/copiesDone", run, results, error: "" }, ctx)[0];
    const text = tab(model, ctx).join("\n");
    expect(text).toContain("✓ 2 spools added: #15, #16");
    expect(text).not.toContain("✓ spool #15");
    expect(text).not.toContain("2 added");
  });

  it("draws the scan, known-barcode and choose dialogs", () => {
    const barcodes = new Map([["0015", { code: "P4840583", name: "Sunlu PETG 2.0 Vivid Yellow" }]]);
    const scan = spoolsTab.update(
      keys(start(ctx), ctx, "b"),
      { type: "spools/barcodes", barcodes },
      ctx,
    )[0];
    const scanLines = tab(keys(scan, ctx, "00"), ctx);
    let text = scanLines.join("\n");
    expect(text).toContain("Scan a barcode");
    expect(text).not.toContain("Scan the spool's barcode");
    expect(text).toContain("Barcode  00");
    expect(flat(scanLines)).toContain(
      "1 barcode known; a new one asks which filament it is, once.",
    );
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
      expect(text).toContain("Added     Oct 30");
    },
  );
});

describe.each(SIZES)("the spool detail at %ix%i", (columns, rows) => {
  const NOTE =
    "Generated by bambu-hando for Sunlu PETG 2.0 Vivid Yellow, dried at 65°C for four hours before the first print";
  const NAME = "Polymaker PETG PolyLite Galaxy Dark Blue Sparkle Edition with a very long name";
  const ctx = ctxAt(columns, rows, {
    resources: {
      console: consoleOf(
        [
          spool({
            id: "14",
            slicerFilament: "",
            brand: NAME,
            material: "",
            colorName: "",
            note: NOTE,
          }),
        ],
        FILAMENTS,
      ),
    },
  });

  it("names a long filament whole at the top of its count dialog", () => {
    const coded = ctxAt(columns, rows, {
      resources: {
        console: consoleOf(
          [spool({ id: "14", slicerFilament: "P4840583", colorName: "x" })],
          new Map([["P4840583", { name: NAME, nozzleTempMin: 230, nozzleTempMax: 250 }]]),
        ),
      },
    });
    const lines = tab(keys(start(coded), coded, "+"), coded);
    expectExact(lines, coded);
    expect(flat(lines)).toContain(NAME);
  });

  it("wraps a long note and name instead of cutting them", () => {
    const model = columns < 90 ? keys(start(ctx), ctx, "enter") : start(ctx);
    const lines = tab(model, ctx);
    expectExact(lines, ctx);
    const detail = lines.map((line) => (columns < 90 ? line : line.slice(-46))).join(" ");
    const words = detail.replace(/[│╭╮╰╯─]/g, " ").replace(/\s+/g, " ");
    expect(words).toContain(NOTE);
    expect(words).toContain(NAME.split(" ").slice(0, 6).join(" "));
  });
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
    // The same field names as Settings › Labels.
    expect(text).toContain("[✓] QR code");
    expect(text).toContain("[✓] Color name");
    expect(text).toContain("[ ] Location");
    expect(text).toContain("Save PDF to");
    expect(text).toContain("╭ #14");
    expect(text).toContain("Sunlu");
    expect(text).toContain("230–250°C");
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

  it("names one spool only on its preview card, not again on a line of IDs", () => {
    const [model] = labelsOverlay.init({ spoolIds: ["14"], fresh: false }, ctx);
    const one = labelsOverlay.update(
      model,
      { type: "labels/loaded", settings: DEFAULT_LABEL_SETTINGS, printers: [] },
      ctx,
    )[0];
    const lines = overlay(one);
    expect(lines.some((line) => /^│\s+#14\s+│$/.test(line))).toBe(false);
    expect(lines.join("\n")).toContain("╭ #14");
    const two = overlay(loaded());
    if (rows >= 24) expect(two.some((line) => /^│\s+#14 #13\s+│$/.test(line))).toBe(true);
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
    const many = labelsOverlay.update(
      {
        ...loaded(),
        focus: PRINTER_ROW,
        printers: Array.from({ length: 30 }, (_, i) => `Printer ${i}`),
      },
      { type: "key", key: press("enter") },
      ctx,
    )[0];
    // A list that scrolls says where the cursor is.
    expect(overlay(many).join("\n")).toContain(" 1/31 ");
    expect(text).toContain("Don't print");
    // One of them is chosen: the current printer carries the radio's dot.
    expect(text).toContain("● DYMO");
    expect(text).toContain("○ Don't print");
  });

  it("shows a long PDF path with its file name kept", () => {
    const path = "/home/someone/Documents/3d printing/labels/spools/october/labels-2026-10-30.pdf";
    const model = { ...loaded(), output: { value: path, cursor: path.length } };
    const text = overlay(model).join("\n");
    expect(text).toContain("labels-2026-10-30.pdf");
    expect(text).toContain("…");
  });
});
