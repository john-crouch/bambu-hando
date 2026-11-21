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
  scroll: 0,
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
  [80, 24],
  [120, 36],
])("the Check tab at %ix%i", (columns, rows) => {
  it("shows the sections beside the highlighted one's why and items", () => {
    const ctx = sized(columns, rows, ready(data()));
    const lines = screen(MODEL, ctx);
    fits(lines, ctx);
    expect(lines).toHaveLength(ctx.bodyRows);
    const text = lines.join("\n");
    expect(lines[0]).toContain("✗ 3 problems, 32 notes");
    expect(lines[0]).toContain("BambuStudio default · http://10.0.24.111");
    expect(text).toContain("Filaments without a preset");
    expect(text).toContain("Acme PLA Blue (PA000002)");
    expect(text).toContain("Spools of these find no preset");
    expect(text).not.toContain("SECRETKEY");
  });

  it("scrolls a long section with its position in the border", () => {
    const ctx = sized(columns, rows, ready(data()));
    const lines = screen({ ...MODEL, section: 3, focus: "items", scroll: 5 }, ctx);
    fits(lines, ctx);
    const text = lines.join("\n");
    expect(text).toContain("Polymaker PolyLite PLA Color 05");
    expect(text).not.toContain("Color 04 ");
    expect(text).toMatch(/6–\d+ of 30/);
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
    expect(text).toContain("✓ Sync check ─ ▸ Filament IDs");
    expect(text).toContain("Give 1 preset a filament ID");
    expect(text).toContain(`Rock @X1C.json`);
    expect(text).toContain(fix.id);
    expect(text).toContain("Nothing is written until you press a");
    const done = screen(
      { ...MODEL, page: "ids", ids: { ...ids, results: [{ ...fix, ok: true, detail: "" }] } },
      ctx,
    ).join("\n");
    expect(done).toContain("✓ written");
    expect(done).toContain("✓ 1 preset given an ID");
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
    expect(text).toContain("r check again");
  });

  it("waits with a spinner for the first check", () => {
    const ctx = sized(columns, rows, { state: "loading" });
    expect(screen(MODEL, ctx).join("\n")).toContain(
      "Comparing BambuStudio presets with SpoolEase…",
    );
  });
});
