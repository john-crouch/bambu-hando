// ABOUTME: Render tests for importing your 3DFilamentProfiles spools at 80x24 and 120x36: every state fills the body exactly.
// ABOUTME: Models are put in each state through update() with commands dropped, so no console, API or disk is touched.

import { stripVTControlCharacters } from "node:util";
import { ThemeProvider } from "@inkjs/ui";
import { renderToString } from "ink";
import { describe, expect, it } from "vitest";

import type { TdfpSpool } from "../src/filamentProfiles.js";
import type { ProfilePlan } from "../src/planPreview.js";
import type { ImportPreviewRow } from "../src/tdfpImportSession.js";
import { press } from "../src/tui/core/keys.js";
import type { AppMsg, Ctx, TabMsg } from "../src/tui/core/types.js";
import { addTab } from "../src/tui/tabs/add/index.js";
import type { AddModel } from "../src/tui/tabs/add/model.js";
import { consoleKey } from "../src/tui/tabs/add/tdfpCmds.js";
import { textWidth, theme } from "../src/tui/ui/index.js";
import { ctx as baseCtx, profile } from "./tabAddHarness.js";

const CONSOLE = {
  skipSpoolease: false,
  host: "10.0.0.5",
  securityKey: "SECRET",
};

function sized(columns: number, rows: number, values = {}): Ctx {
  return { ...baseCtx({ values }), columns, rows, bodyColumns: columns, bodyRows: rows - 2 };
}

function spool(overrides: Partial<TdfpSpool> = {}): TdfpSpool {
  return {
    shortCode: "izDGMo7fU",
    filamentId: 10512,
    brand: "SUNLU",
    material: "PETG",
    materialType: "Elite",
    color: "Mildewed Red",
    rgb: "#AD0000",
    remainingGrams: 740,
    emptySpoolWeight: 180,
    location: "Shelf A",
    notes: null,
    updatedAt: "2026-11-01T10:00:00.000Z",
    url: "https://example.invalid/s/izDGMo7fU",
    externalId: null,
    spoolProperties: null,
    ...overrides,
  };
}

const sunlu = spool();
const SUNLU_PROFILE = profile({
  name: "SUNLU PETG Elite Mildewed Red",
  brand: "SUNLU",
  material: "PETG",
  colorName: "Elite Mildewed Red",
  colorRgba: "AD0000FF",
  filamentId: "Pf06dde9",
  nozzleTempMin: 230,
  nozzleTempMax: 260,
  coreWeight: 180,
  settings: { printTemp: 245, bedTemp: 65, flowRatio: 0.95, maxVolumetricSpeed: 11.5 },
});
const acme = spool({
  shortCode: "acme1",
  filamentId: 20,
  brand: "Acme",
  material: "PLA",
  materialType: null,
  color: "Blue",
  rgb: "#0000FF",
  remainingGrams: 1000,
  location: null,
});
const bambu = spool({ shortCode: "bambu1", brand: "Bambu Lab", material: "PLA", color: "Red" });

const ROWS: ImportPreviewRow[] = [
  { spool: sunlu, item: { spool: sunlu, profile: SUNLU_PROFILE, calibrated: true }, refusal: null },
  { spool: acme, item: null, refusal: null },
  {
    spool: bambu,
    item: null,
    refusal:
      "a Bambu Lab filament: BambuStudio has its own presets for it, so add the spool on SpoolEase directly",
  },
];

const plan = (changes: Partial<ProfilePlan> = {}): ProfilePlan => ({
  presets: 1,
  existingPresets: 0,
  nozzleRange: { low: 230, high: 260 },
  filament: { state: "new", listed: "", becomes: "" },
  spool: null,
  ...changes,
});

/** The model after the messages (keys as strings), commands dropped. */
function after(context: Ctx, ...msgs: (AppMsg | TabMsg | string)[]): AddModel {
  let [model] = addTab.init(context, { query: "" });
  for (const msg of msgs) {
    const m: AppMsg | TabMsg = typeof msg === "string" ? { type: "key", key: press(msg) } : msg;
    [model] = addTab.update(model, m, context);
  }
  return model;
}

function step(model: AddModel, context: Ctx, msg: AppMsg | TabMsg | string): AddModel {
  const m: AppMsg | TabMsg = typeof msg === "string" ? { type: "key", key: press(msg) } : msg;
  return addTab.update(model, m, context)[0];
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

const OPEN = ["esc", "end", "enter"];

function listed(context: Ctx, rows = ROWS, linked = 1): AddModel {
  return after(context, ...OPEN, {
    type: "add/tdfpListed",
    console: consoleKey(context.values),
    rows,
    linked,
    warnings: [],
  });
}

function failed(context: Ctx, problem: "noKey" | "spoolease" | "other", error: string): AddModel {
  return after(context, ...OPEN, {
    type: "add/tdfpListFailed",
    console: consoleKey(context.values),
    error,
    problem,
  });
}

function reviewed(context: Ctx): AddModel {
  const loading = step(step(listed(context), context, "space"), context, "right");
  return step(loading, context, {
    type: "add/tdfpPrepared",
    seq: loading.tdfp.review?.seq ?? 0,
    prepared: {
      items: [{ spool: sunlu, profile: SUNLU_PROFILE, calibrated: false }],
      refused: [{ code: "bambu1", reason: "a Bambu Lab filament" }],
    },
    plans: [plan()],
    calls: 1,
    linkCalls: 1,
    warnings: [],
  });
}

function pages(context: Ctx): [string, AddModel, Ctx?][] {
  const review = reviewed(context);
  const running = step(review, context, "a");
  const done = step(running, context, {
    type: "add/tdfpApplied",
    outcomes: [
      {
        code: "izDGMo7fU",
        name: "SUNLU PETG Elite Mildewed Red",
        swatch: "#AD0000",
        filamentId: "Pf06dde9",
        spoolId: "7",
        error: null,
        warning: "its SpoolEase ID wasn't written to 3DFP: 500",
      },
    ],
    calls: 1,
    wrotePresets: true,
    warnings: [],
  });
  const runFailed = step(running, context, {
    type: "add/tdfpApplyFailed",
    error: "SpoolEase key validation failed",
    exitCode: 2,
  });
  const noConsole = sized(context.columns, context.rows, { skipSpoolease: false });
  return [
    ["sources", after(context, "esc", "end")],
    ["no console", after(noConsole, ...OPEN), noConsole],
    ["loading", after(context, ...OPEN)],
    [
      "no key",
      failed(
        context,
        "noKey",
        "no 3DFilamentProfiles API key: run `bambu-hando key set 3dfp`, or set FILAMENTPROFILES_API_KEY",
      ),
    ],
    ["console refused", failed(context, "spoolease", "SpoolEase key validation failed")],
    ["failed", failed(context, "other", "3DFilamentProfiles answered 500")],
    ["all linked", listed(context, [], 3)],
    ["list", listed(context)],
    ["list, record not read yet", step(listed(context), context, "down")],
    ["list, refused", step(step(listed(context), context, "down"), context, "down")],
    ["review loading", step(step(listed(context), context, "space"), context, "right")],
    ["review", review],
    ["review, refused row", step(review, context, "down")],
    ["running", running],
    ["done", done],
    ["run failed", runFailed],
  ];
}

describe.each([
  [80, 24],
  [120, 36],
])("at %ix%i", (columns, rows) => {
  const context = sized(columns, rows, CONSOLE);

  it.each(pages(context))(
    "%s fills the body exactly, every line full width",
    (_name, model, own) => {
      const lines = screen(model, own ?? context);
      expect(lines).toHaveLength(context.bodyRows);
      // Ink trims trailing spaces, so only bordered lines measure their full width.
      for (const [index, line] of lines.entries()) {
        const bordered = /^[╭│╰]/.test(line);
        if (bordered) expect(textWidth(line), `line ${index}: ${line}`).toBe(columns);
        else expect(textWidth(line), `line ${index}: ${line}`).toBeLessThanOrEqual(columns);
      }
      expect(lines.join("\n")).not.toContain("SECRET");
    },
  );

  it("says what importing the highlighted spool writes, and why a refused one isn't", () => {
    const text = screen(listed(context), context).join("\n");
    expect(text).toMatch(/Your 3DFP spools · 2 to import · 1 linked/);
    expect(text).toMatch(/\[ \] SUNLU PETG Elite Mildewed Red\s+740 g/);
    expect(text).toMatch(/✗\s+Bambu Lab PLA Elite Red/);
    expect(text).toContain("Pf06dde9");
    const refused = screen(
      step(step(listed(context), context, "down"), context, "down"),
      context,
    ).join("\n");
    expect(refused).toContain("Bambu Lab");
    expect(refused).toContain("BambuStudio has its");
  });

  it("names every target on review, and the calls it costs", () => {
    const text = screen(reviewed(context), context).join("\n");
    expect(text).toContain("1 spool from 3DFilamentProfiles");
    expect(text).toMatch(/Printers\s+X1C 0.4/);
    expect(text).toContain("http://10.0.0.5");
    expect(text).toMatch(/3DFP\s+links \+ SpoolEase IDs · 1 API call read, 1 to apply/);
    expect(text).toMatch(/\+ new\s+add \+ spool \+ link/);
    expect(text).toContain("✗ not imported");
  });
});

describe("what the import's pages say", () => {
  const context = sized(120, 36, CONSOLE);
  const shown = Object.fromEntries(
    pages(context).map(([name, model, own]) => [name, screen(model, own ?? context).join("\n")]),
  );

  it("lists 3DFP's spools as a source, read only when opened", () => {
    expect(shown.sources).toContain("Your 3DFilamentProfiles spools");
    expect(shown.sources).toContain("importing one writes its BambuStudio presets");
  });

  it("has a state for every way there's no list", () => {
    expect(shown["no console"]).toContain("SpoolEase isn't set up");
    expect(shown["no console"]).toContain("enter open Settings › SpoolEase");
    expect(shown.loading).toContain("Reading your 3DFilamentProfiles spools…");
    expect(shown["no key"]).toContain("No 3DFilamentProfiles API key");
    expect(shown["no key"]).toContain("bambu-hando key set 3dfp");
    expect(shown["no key"]).toContain("r try again");
    expect(shown["console refused"]).toContain("s fix in Settings");
    expect(shown.failed).toContain("Couldn't read your 3DFilamentProfiles spools");
    expect(shown["all linked"]).toContain("Every 3DFP spool is already linked");
  });

  it("shows the preview's plan, and what Review reads first", () => {
    expect(shown.list).toContain("+ SpoolEase's custom filament Pf06dde9");
    expect(shown.list).toContain("print 245°C · bed 65°C");
    expect(shown.list).toMatch(/Your calibration goes first: read on Review[\s│]*\(1 API call\)/);
    expect(shown["list, record not read yet"]).toMatch(
      /read[\s│]*from 3DFP on Review \(1 API call\)/,
    );
    expect(shown.list).toContain("Nothing ticked yet: space ticks a spool");
  });

  it("shows the run, then each spool's SpoolEase spool and what to do next", () => {
    expect(shown.running).toContain("… working");
    expect(shown.done).toContain("✓ 1 spool imported");
    expect(shown.done).toContain("✓ spool #7");
    expect(shown.done).toContain("Restart BambuStudio to see the new presets.");
    expect(shown.done).toContain("bambu-hando 3dfp sync then keeps the weights in step");
    expect(shown.done).toContain("its SpoolEase ID wasn't written to 3DFP");
    expect(shown["run failed"]).toContain("✗ SpoolEase key validation failed");
  });
});
