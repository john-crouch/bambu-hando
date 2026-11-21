// ABOUTME: Renders the Check tab's view at 80x24 and 120x36: the report, the ID review and the empty, busy, failed states.
// ABOUTME: Asserts every screen fits the body exactly and says the right things; SNAP=1 prints the screens.

import { stripVTControlCharacters } from "node:util";
import { ThemeProvider } from "@inkjs/ui";
import { renderToString } from "ink";
import { describe, expect, it } from "vitest";

import { derivedFilamentId } from "../src/sources.js";
import type { SpoolRecord } from "../src/spoolease.js";
import { checkSync } from "../src/syncCheck.js";
import type { CheckData, Ctx, Resource } from "../src/tui/core/types.js";
import { checkTab } from "../src/tui/tabs/check/index.js";
import type { CheckModel } from "../src/tui/tabs/check/model.js";
import { textWidth, theme } from "../src/tui/ui/index.js";
import { ctxOf } from "./tabSettingsHarness.js";

const CONSOLE = { host: "10.0.24.111", securityKey: "SECRETKEY" };

function spool(id: string, overrides: Partial<SpoolRecord> = {}): SpoolRecord {
  return {
    id,
    tagId: "",
    material: "PLA",
    subtype: "",
    colorName: "Red",
    colorCodes: [],
    note: "",
    brand: "Acme",
    labelWeight: null,
    coreWeight: null,
    fullWeight: null,
    currentWeight: null,
    consumedSinceWeighed: 0,
    slicerFilament: "",
    addedTime: null,
    location: "",
    ...overrides,
  };
}

const PRESETS = [
  ...Array.from({ length: 30 }, (_, i) => ({
    name: `Polymaker PolyLite PLA Color ${String(i).padStart(2, "0")}`,
    filamentId: `P${String(i).padStart(7, "0")}`,
    printer: "Bambu Lab X1 Carbon 0.4 nozzle",
    path: `/p/${i}.json`,
  })),
  {
    name: "Rock",
    filamentId: "",
    printer: "X1C",
    path: "/home/u/.config/BambuStudio/user/default/filament/base/Rock @X1C.json",
  },
];

function data(warnings: string[] = []): CheckData {
  const csv = "PA000001,Acme PLA Red,190,230,PLA\r\nPA000002,Acme PLA Blue,190,230,PLA\r\n";
  const spools = [spool("3"), spool("4", { slicerFilament: "PZZZZZZ" })];
  return { sections: checkSync({ presets: PRESETS, csv, spools }), warnings, presets: PRESETS };
}

function sized(columns: number, rows: number, check: Resource<CheckData>, values = CONSOLE): Ctx {
  return { ...ctxOf(values, { check }), columns, rows, bodyColumns: columns, bodyRows: rows - 2 };
}

const MODEL: CheckModel = {
  page: "report",
  section: 0,
  focus: "sections",
  item: 0,
  placed: true,
  ids: null,
};

function screen(model: CheckModel, ctx: Ctx): string[] {
  const out = renderToString(
    <ThemeProvider theme={theme}>
      <checkTab.View model={model} ctx={ctx} />
    </ThemeProvider>,
    { columns: ctx.bodyColumns },
  );
  const lines = stripVTControlCharacters(out).split("\n");
  if (process.env.SNAP) console.log(lines.join("\n"));
  return lines;
}

function fits(lines: string[], ctx: Ctx): void {
  expect(lines.length).toBeLessThanOrEqual(ctx.bodyRows);
  for (const line of lines) expect(textWidth(line)).toBeLessThanOrEqual(ctx.bodyColumns);
}

const ready = (value: CheckData): Resource<CheckData> => ({ state: "ready", value, at: 1 });

describe.each([
  [60, 20],
  [80, 24],
  [120, 36],
])("the Check tab at %ix%i", (columns, rows) => {
  it("shows the sections beside the highlighted one's why and items", () => {
    const ctx = sized(columns, rows, ready(data()));
    const lines = screen(MODEL, ctx);
    fits(lines, ctx);
    expect(lines).toHaveLength(ctx.bodyRows);
    const text = lines.join("\n");
    expect(lines[0]).toContain("✗ 3 problems · 32 notes");
    if (columns >= 80)
      expect(lines[0]).toContain("32 notes · BambuStudio default with http://10.0.24.111");
    expect(text).toContain(columns >= 100 ? "Filaments without a preset" : "No preset");
    expect(text).toContain("Acme PLA Blue");
    expect(text).not.toMatch(/Filament…|Spools o…|Presets…/);
    expect(text).toContain("Spools of these find no preset");
    expect(text).not.toContain("SECRETKEY");
  });

  it("highlights the item the cursor is on, keeps it in view, and says where it is", () => {
    const ctx = sized(columns, rows, ready(data()));
    const lines = screen({ ...MODEL, section: 3, focus: "items", item: 20 }, ctx);
    fits(lines, ctx);
    const text = lines.join("\n");
    const cursorLine = lines.find((line) => line.includes("Color 20"));
    expect(cursorLine).toMatch(/│▌Polymaker PolyLite PLA Color 20/);
    expect(text).toContain("21/30");
    // The name is the part that differs: it's never cut while a printer or code column is shown.
    for (const line of lines.filter((l) => l.includes("Polymaker")))
      expect(line).toMatch(/Color \d\d/);
  });

  it("shows presets with short printers, never the vendor", () => {
    const ctx = sized(columns, rows, ready(data()));
    const text = screen({ ...MODEL, section: 3, focus: "items" }, ctx).join("\n");
    expect(text).not.toContain("Bambu Lab");
    if (columns >= 80) expect(text).toContain("X1C 0.4");
  });

  it("gives the items the whole width below 70 columns while they have focus", () => {
    const ctx = sized(columns, rows, ready(data()));
    const lines = screen({ ...MODEL, section: 3, focus: "items" }, ctx);
    fits(lines, ctx);
    expect(lines.some((line) => line.includes("Sections"))).toBe(columns >= 70);
  });

  it("marks the console's sections not checked when it can't be reached, and still checks presets", () => {
    const ctx = {
      ...sized(columns, rows, {
        state: "failed",
        error: "SpoolEase unreachable at http://10.0.24.111: fetch failed",
      }),
    };
    const offline = {
      ...ctx,
      resources: {
        ...ctx.resources,
        presets: { state: "ready" as const, value: { presets: PRESETS, warnings: [] }, at: 1 },
      },
    };
    const lines = screen(MODEL, offline);
    fits(lines, offline);
    const text = lines.join("\n");
    expect(lines[0]).toContain("✗ Couldn't check the console");
    expect(text).toContain("Not checked: SpoolEase");
    expect(text).toContain("unreachable");
    // What to check is said; the key that goes there is the footer's alone.
    expect(text).toContain("check the host");
    expect(text).not.toContain("enter open Settings");
    const presets = screen({ ...MODEL, section: 4 }, offline).join("\n");
    expect(presets).toContain("Rock");
  });

  it("counts a preset section's presets, and its files when a preset has several", () => {
    const value = data();
    const twoFiles = [...PRESETS, { ...PRESETS.at(-1)!, printer: "X1C 0.6", path: "/p/r6.json" }];
    const ctx = sized(
      columns,
      rows,
      ready({
        ...value,
        sections: checkSync({ presets: twoFiles, csv: "", spools: [] }),
        presets: twoFiles,
      }),
    );
    const noId =
      ctx.resources.check.state === "ready"
        ? ctx.resources.check.value.sections.findIndex((s) => s.key === "presetsNoId")
        : -1;
    const lines = screen({ ...MODEL, section: noId }, ctx);
    fits(lines, ctx);
    // Where both don't fit beside the title, the files go before anything is cut.
    expect(lines.join("\n")).toContain(
      columns >= 80 ? "1 preset, 2 files" : "No filament ID · 1 preset ─",
    );
    expect(lines.join("\n")).not.toMatch(/2…|presets?…/);
    expect(
      screen({ ...MODEL, section: 3 }, sized(columns, rows, ready(value))).join("\n"),
    ).toContain("30 presets");
  });

  it("shows BambuStudio's own printer names short too", () => {
    const presets = [
      { name: "Rock", filamentId: "", printer: "BBL X1C", path: "/p/a.json" },
      { name: "Rock", filamentId: "", printer: "BBL X1", path: "/p/b.json" },
    ];
    const ctx = sized(
      columns,
      rows,
      ready({ sections: checkSync({ presets, csv: "", spools: [] }), warnings: [], presets }),
    );
    const noId = 4;
    const text = screen({ ...MODEL, section: noId }, ctx).join("\n");
    expect(text).not.toContain("BBL");
    expect(text).toContain("X1C, X1");
  });

  it("says an empty section has nothing in it", () => {
    const ctx = sized(columns, rows, ready(data()));
    const text = screen({ ...MODEL, section: 2 }, ctx).join("\n");
    expect(text).toContain("✓ Nothing here");
  });

  it("shows warnings above the panes and still fits", () => {
    const ctx = sized(
      columns,
      rows,
      ready(data(["Couldn't read BambuStudio preset a.json: bad", "two", "three"])),
    );
    const lines = screen(MODEL, ctx);
    fits(lines, ctx);
    expect(lines[1]).toContain("! Couldn't read BambuStudio preset a.json");
    expect(lines[2]).toContain("… and 2 more warnings");
  });

  it("keeps the last check on screen while checking again or after a failure", () => {
    const loading = sized(columns, rows, { state: "loading", previous: data() });
    const lines = screen(MODEL, loading);
    fits(lines, loading);
    expect(lines[0]).toContain("Checking again…");
    const failed = sized(columns, rows, {
      state: "failed",
      error: "SpoolEase key validation failed",
      previous: data(),
    });
    expect(screen(MODEL, failed)[0]).toContain(
      "✗ Couldn't check again: SpoolEase key validation failed",
    );
  });

  it("shows the review of the filament IDs, then their results", () => {
    const ctx = sized(columns, rows, ready(data()));
    const fix = {
      path: PRESETS.at(-1)!.path,
      name: "Rock",
      printer: "X1C",
      id: derivedFilamentId("Rock"),
    };
    const ids = { fixes: [fix], results: null, running: false, scroll: 0 };
    const lines = screen({ ...MODEL, page: "ids", ids }, ctx);
    fits(lines, ctx);
    expect(lines).toHaveLength(ctx.bodyRows);
    const text = lines.join("\n");
    // The title says where you are: no page bar for a page reached only from the check.
    expect(text).not.toContain("Sync check ─");
    expect(lines[0]).toContain("Give 1 preset a filament ID");
    expect(text).toContain("BambuStudio default");
    expect(text).toMatch(/Preset file +Filament ID/);
    expect(text).toContain(`Rock @X1C.json`);
    expect(text).toContain(fix.id);
    expect(text).not.toContain("until you press a");
    expect(text).toContain("1 preset to write");
    const two = { ...ids, fixes: [fix, { ...fix, path: "/p/Rock @X1C 0.6.json" }] };
    expect(screen({ ...MODEL, page: "ids", ids: two }, ctx).join("\n")).toContain(
      "1 preset, 2 files to write",
    );
    const done = screen(
      { ...MODEL, page: "ids", ids: { ...ids, results: [{ ...fix, ok: true, detail: "" }] } },
      ctx,
    ).join("\n");
    expect(done).toContain("✓ written");
    expect(done).toContain("✓ 1 preset given an ID");
  });

  it("gives the file names the room the results don't use yet", () => {
    const ctx = sized(columns, rows, ready(data()));
    const name = "Acme Rock PLA @Bambu Lab X1 Carbon 0.4 nozzle.json";
    const fix = { path: `/p/${name}`, name: "Acme Rock PLA", printer: "X1C", id: "P1234567" };
    const ids = { fixes: [fix], results: null, running: false, scroll: 0 };
    const lines = screen({ ...MODEL, page: "ids", ids }, ctx);
    fits(lines, ctx);
    if (columns >= 80) expect(lines.join("\n")).toContain(name);
    const failed = {
      ...ids,
      results: [{ ...fix, ok: false, detail: "EACCES: permission denied" }],
    };
    const after = screen({ ...MODEL, page: "ids", ids: failed }, ctx);
    fits(after, ctx);
    expect(after.join("\n")).toContain("✗ EACCES");
  });

  it("sends you to Settings without a console", () => {
    const ctx = sized(columns, rows, { state: "idle" }, { host: "", securityKey: "" });
    const lines = screen(MODEL, ctx);
    fits(lines, ctx);
    const text = lines.join("\n");
    expect(text).toContain("No SpoolEase console to check against");
    expect(text).toContain("enter open Settings");
  });

  it("says the check failed when there's nothing to show", () => {
    const ctx = sized(columns, rows, {
      state: "failed",
      error: "SpoolEase unreachable at http://10.0.24.111: fetch failed",
    });
    const text = screen(MODEL, ctx).join("\n");
    expect(text).toContain("Couldn't check");
    expect(text).toContain("check the host");
    // The keys (enter open Settings, r check again) are the footer's.
    expect(text).not.toContain("r check again");
  });

  it("waits with a spinner for the first check", () => {
    const ctx = sized(columns, rows, { state: "loading" });
    expect(screen(MODEL, ctx).join("\n")).toContain(
      "Comparing BambuStudio presets with SpoolEase…",
    );
  });
});
