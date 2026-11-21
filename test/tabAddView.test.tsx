// ABOUTME: Render tests for the Add tab's body at 80x24 and 120x36: every page exactly fills the body, line by line.
// ABOUTME: Models are put in each state through update() with commands dropped, so no console or disk is touched.

import { stripVTControlCharacters } from "node:util";
import { ThemeProvider } from "@inkjs/ui";
import { renderToString } from "ink";
import { describe, expect, it } from "vitest";

import type { SyncResult } from "../src/models.js";
import type { ProfilePlan } from "../src/planPreview.js";
import { parseSpoolWeightList } from "../src/spoolWeights.js";
import { press } from "../src/tui/core/keys.js";
import type { AppMsg, Ctx, TabMsg } from "../src/tui/core/types.js";
import { addTab } from "../src/tui/tabs/add/index.js";
import type { AddModel } from "../src/tui/tabs/add/model.js";
import { planBasis } from "../src/tui/tabs/add/targets.js";
import { textWidth, theme } from "../src/tui/ui/index.js";
import { ctx as baseCtx } from "./tabAddHarness.js";

function sized(columns: number, rows: number, values = {}): Ctx {
  return { ...baseCtx({ values }), columns, rows, bodyColumns: columns, bodyRows: rows - 2 };
}

/** The model after the messages, commands dropped. */
function after(context: Ctx, ...msgs: (AppMsg | TabMsg | string)[]): AddModel {
  let [model] = addTab.init(context, { query: "" });
  for (const msg of msgs) {
    const m: AppMsg | TabMsg = typeof msg === "string" ? { type: "key", key: press(msg) } : msg;
    [model] = addTab.update(model, m, context);
  }
  return model;
}

function screen(model: AddModel, context: Ctx): string[] {
  const out = renderToString(
    <ThemeProvider theme={theme}>
      <addTab.View model={model} ctx={context} />
    </ThemeProvider>,
    { columns: context.columns },
  );
  return stripVTControlCharacters(out).split("\n");
}

const plan = (changes: Partial<ProfilePlan> = {}): ProfilePlan => ({
  presets: 1,
  existingPresets: 0,
  nozzleRange: { low: 200, high: 220 },
  filament: { state: "new", listed: "", becomes: "" },
  spool: "create",
  ...changes,
});

const CONSOLE = {
  skipSpoolease: false,
  host: "10.0.0.5",
  securityKey: "SECRET",
  createSpools: false,
};

/** Every page the tab has, in a representative state. */
function pages(context: Ctx): [string, AddModel][] {
  const toColors = ["enter", "down", "enter"];
  const reviewing = after(context, ...toColors, "space", "space", "right");
  const ready = after(context, ...toColors, "space", "space", "right", {
    type: "add/planRead",
    seq: reviewing.review.seq,
    plans: [plan(), plan({ existingPresets: 1 })],
    warnings: ["SpoolEase was slow"],
  });
  const running = addTab.update(ready, { type: "key", key: press("a") }, context)[0];
  const result = (name: string, spoolId: string): SyncResult => ({
    profileName: name,
    filamentId: "P1",
    bambuStatus: "written",
    spooleaseStatus: "written",
    detail: "",
    coreWeight: 200,
    spoolId,
  });
  const done = addTab.update(
    running,
    { type: "add/runDone", results: [result("Acme PLA Blue", "7"), result("Acme PLA Black", "8")] },
    context,
  )[0];
  return [
    ["brands", after(context)],
    ["colors", after(context, ...toColors, "space")],
    ["other color", after(context, ...toColors, "end", "enter", "right", "down", "Moss")],
    ["search", after(context, "/", "acme pla", "enter", "space")],
    ["review loading", reviewing],
    ["review", ready],
    ["running", running],
    ["done", done],
  ];
}

describe.each([
  [80, 24],
  [120, 36],
])("at %ix%i", (columns, rows) => {
  const context = sized(columns, rows, CONSOLE);

  it.each(pages(context))("%s fills the body exactly, every line full width", (_name, model) => {
    const lines = screen(model, context);
    expect(lines).toHaveLength(context.bodyRows);
    // Ink trims trailing spaces, so only bordered lines measure their full width.
    for (const [index, line] of lines.entries()) {
      const bordered = /^[╭│╰]/.test(line);
      if (bordered) expect(textWidth(line), `line ${index}: ${line}`).toBe(columns);
      else expect(textWidth(line), `line ${index}: ${line}`).toBeLessThanOrEqual(columns);
    }
    expect(lines.join("\n")).not.toContain("SECRET");
  });

  it("asks for weights in a panel per brand", () => {
    const spools = { ...CONSOLE, createSpools: true };
    const c = sized(columns, rows, spools);
    const loading = after(c, "enter", "down", "enter", "space", "right");
    const model = addTab.update(
      loading,
      {
        type: "add/weightsRead",
        signature: loading.weights.signature,
        entries: parseSpoolWeightList("Acme - Plastic - 180g,180,Acme - Cardboard - 140g,140"),
        warnings: [],
        spooled: [],
        remembered: {},
      },
      c,
    )[0];
    const lines = screen(model, c);
    expect(lines).toHaveLength(c.bodyRows);
    for (const line of lines) expect(textWidth(line)).toBeLessThanOrEqual(columns);
    const text = lines.join("\n");
    expect(text).toContain("Empty spool weight · Acme");
    expect(text).toMatch(/Acme - Plastic\s+180 g/);
    expect(text).toContain("As listed in SpoolmanDB");
    expect(text).toContain("brand 1 of 1");
  });
});

describe("what the pages say", () => {
  const context = sized(120, 36, CONSOLE);
  const [brands, colors, other, search, , review, running, done] = pages(context).map(([, m]) =>
    screen(m, context).join("\n"),
  );

  it("shows brands with counts and the detail of the highlighted one", () => {
    expect(brands).toContain("▸ Find");
    expect(brands).toMatch(/SpoolmanDB · 2 brands/);
    expect(brands).toMatch(/Acme\s+4 colors/);
    expect(brands).toMatch(/PETG\s+1 color/);
    expect(brands).toContain("Nothing ticked yet");
  });

  it("shows colors with ticks and temperatures, codes in the detail, Other color…, and what adding writes", () => {
    expect(colors).toMatch(/\[✓\] Black\s+200–220°C /);
    expect(colors).toMatch(/Code\s+PACMBLU0/);
    expect(colors).not.toContain("space ticks it");
    expect(colors).toContain("+  Other color…");
    expect(colors).toContain("Checking what's there already…");
    expect(colors).not.toContain("+ a SpoolEase");
    expect(colors).toMatch(/✓ 1 ticked\s+Acme PLA/);
  });

  it("says what adding the color does once it's read, and never what's there already", () => {
    for (const [columns, rows] of [
      [120, 36],
      [80, 24],
      [60, 20],
    ] as const) {
      const c = sized(columns, rows, { ...CONSOLE, createSpools: true });
      const colorsPage = after(c, "enter", "down", "enter", "down");
      const peeked = addTab.update(
        addTab.update(
          colorsPage,
          { type: "add/peekConsole", basis: planBasis(c.values), state: null },
          c,
        )[0],
        {
          type: "add/peeked",
          basis: planBasis(c.values),
          filamentId: "PACMBLU0",
          plan: plan({
            existingPresets: 1,
            filament: { state: "same", listed: "", becomes: "" },
            spool: "create",
          }),
        },
        c,
      )[0];
      const lines = screen(peeked, c);
      for (const line of lines) expect(textWidth(line)).toBeLessThanOrEqual(columns);
      const text = lines.join("\n");
      if (columns === 60) expect(text).toMatch(/Adding it = preset kept · = listed · \+ spool/);
      else {
        expect(text).toContain("= BambuStudio preset for X1C 0.4: kept");
        expect(text).toContain("= on SpoolEase's custom filaments already");
        expect(text).toContain("+ a SpoolEase spool");
      }
    }
  });

  it("gives the Other color dialog to the shell's dialog layer, not the body", () => {
    expect(other).not.toContain("Other color · Acme PLA");
    const model = pages(context).find(([name]) => name === "other color")?.[1];
    if (!model) throw new Error("no other color page");
    const dialog = addTab.dialog?.(model, context);
    if (!dialog) throw new Error("no dialog");
    const out = stripVTControlCharacters(
      renderToString(<ThemeProvider theme={theme}>{dialog}</ThemeProvider>, {
        columns: context.columns,
      }),
    );
    expect(out).toContain("Other color · Acme PLA");
    expect(out).toMatch(/Settings from\s+‹/);
    expect(out).toContain("Moss");
    expect(addTab.dialog?.(after(context), context)).toBeNull();
  });

  it("shows the search query and its matches", () => {
    expect(search).toContain("Search SpoolmanDB · 3 matches");
    expect(search).toContain("/ acme pla");
  });

  it("names every target and shows the plan with notes and warnings", () => {
    expect(review).toMatch(/Presets\s+~\/.*filament\/base · existing kept/);
    expect(review).toMatch(/SpoolEase\s+http:\/\/10\.0\.0\.5 · filaments only/);
    expect(review).toMatch(/\+ new\s+add \+ spool/);
    expect(review).toMatch(/= kept\s+add \+ spool/);
    expect(review).toContain("= kept: 1 preset is there already");
    expect(review).toContain("Plan · Acme PLA · what applying does");
    expect(review).toContain("! SpoolEase was slow");
  });

  it("shows progress while running and the outcome when done", () => {
    expect(running).toContain("Running");
    expect(running).toContain("Starting…");
    expect(done).toContain("✓ 2 written · 2 new spools");
    expect(done).not.toContain("failed");
    expect(done).toContain("▸ Done");
  });
});

describe("the preset editor on Review", () => {
  it.each([
    [80, 24],
    [120, 36],
  ])("fills the body at %ix%i and marks the edited row back on the plan", (columns, rows) => {
    const context = sized(columns, rows);
    const model = after(context, "enter", "down", "enter", "space", "right");
    const ready = addTab.update(
      model,
      { type: "add/planRead", seq: model.review.seq, plans: [plan()], warnings: [] },
      context,
    )[0];
    const editing = addTab.update(
      ready,
      {
        type: "add/plannedPreset",
        seq: ready.review.seq,
        filamentId: "PACMBLK0",
        name: "Acme PLA Black",
        printer: "Bambu Lab X1 Carbon 0.4 nozzle",
        path: "/tmp/x.json",
        original: {
          nozzle_temperature: ["210"],
          nozzle_temperature_range_low: ["200"],
          nozzle_temperature_range_high: ["220"],
        },
      },
      context,
    )[0];
    const lines = screen(editing, context);
    expect(lines).toHaveLength(context.bodyRows);
    for (const line of lines) expect(textWidth(line)).toBeLessThanOrEqual(columns);
    const text = lines.join("\n");
    expect(text).toContain("Edit Acme PLA Black");
    expect(text).toContain("The run writes this preset for X1C 0.4 with these changes");

    const edited = addTab.update(
      ready,
      {
        type: "add/planEdits",
        filamentId: "PACMBLK0",
        edits: new Map([["nozzle_temperature", { every: "215" }]]),
      },
      context,
    )[0];
    const back = addTab.update(
      edited,
      { type: "add/planRead", seq: edited.review.seq, plans: [plan()], warnings: [] },
      context,
    )[0];
    const plan80 = screen(back, context).join("\n");
    expect(plan80).toContain("✎ Black");
    expect(plan80).toContain("✎ PACMBLK0: 1 change goes into the 1 preset the run writes");
  });
});

describe("a narrow table", () => {
  it("drops brand and material below 100 columns and keeps the code", () => {
    const context = sized(80, 24);
    const model = after(context, "enter", "down", "enter", "space", "right");
    const ready = addTab.update(
      model,
      {
        type: "add/planRead",
        seq: model.review.seq,
        plans: [plan({ filament: null, spool: null })],
        warnings: [],
      },
      context,
    )[0];
    const text = screen(ready, context).join("\n");
    expect(text).toMatch(/Name\s+Nozzle\s+Code/);
    expect(text).not.toMatch(/Brand\s+Material/);
    expect(text).toContain("PACMBLK0");
  });
});
