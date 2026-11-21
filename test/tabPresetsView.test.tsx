// ABOUTME: Render tests for the Presets tab at 80x24 and 120x36: the list with its detail, the editor, the review.
// ABOUTME: Every body line must be exactly the terminal's width and the body exactly its height.

import { stripVTControlCharacters } from "node:util";
import { ThemeProvider } from "@inkjs/ui";
import { renderToString } from "ink";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Preset } from "../src/presetEdit.js";
import type { UserPreset } from "../src/syncCheck.js";
import { press } from "../src/tui/core/keys.js";
import type { AppMsg, Ctx, TabMsg } from "../src/tui/core/types.js";
import { presetsTab } from "../src/tui/tabs/presets/index.js";
import type { PresetsModel } from "../src/tui/tabs/presets/model.js";
import { frameBody } from "../src/tui/ui/Frame.js";
import { textWidth } from "../src/tui/ui/text.js";
import { theme } from "../src/tui/ui/theme.js";

const HOME = "/home/maker";
const BASE = `${HOME}/.config/BambuStudio/user/default/filament/base`;
const X1C_04 = "Bambu Lab X1 Carbon 0.4 nozzle";
const X1C_06 = "Bambu Lab X1 Carbon 0.6 nozzle";

function presetJson(name: string, printer: string, id: string, colour = "#F1C400"): Preset {
  return {
    name: `${name} @${printer}`,
    filament_id: id,
    inherits: "",
    nozzle_temperature: ["255"],
    nozzle_temperature_initial_layer: ["255"],
    nozzle_temperature_range_low: ["230"],
    nozzle_temperature_range_high: ["270"],
    textured_plate_temp: ["70"],
    hot_plate_temp: ["70"],
    filament_flow_ratio: ["0.95"],
    filament_max_volumetric_speed: ["12"],
    fan_min_speed: ["40"],
    fan_max_speed: ["90"],
    filament_density: ["1.22"],
    filament_cost: ["30"],
    default_filament_colour: [colour],
    filament_vendor: ["Sunlu"],
  };
}

function preset(name: string, printer: string, id: string): UserPreset {
  return { name, printer, filamentId: id, path: `${BASE}/${name} @${printer}.json` };
}

const PRESETS: UserPreset[] = [
  preset("Sunlu PETG 2.0 Vivid Yellow", X1C_04, "P4840583"),
  preset("Sunlu PETG 2.0 Vivid Yellow", X1C_06, "P4840583"),
  preset("OVERTURE PLA Basic", X1C_04, "P661a077"),
  preset("OVERTURE ROCK PLA", "BBL X1C", ""),
  preset("Polymaker PolyLite™ PETG Galaxy Dark Blue With A Long Name", X1C_04, "Pabcdef1"),
];

function ctxFor(columns: number, rows: number): Ctx {
  const body = frameBody(columns, rows);
  return {
    values: {
      source: "spoolmandb",
      presetFolder: "default",
      printerPreset: X1C_04,
      overwritePresets: false,
      host: "",
      port: "80",
      securityKey: "",
      https: false,
      skipSpoolease: true,
      createSpools: true,
      query: "",
      diameter: 1.75,
    },
    resources: {
      console: { state: "idle" },
      presets: { state: "ready", value: { presets: PRESETS, warnings: [] }, at: 0 },
      catalog: { state: "idle" },
      check: { state: "idle" },
    },
    columns,
    rows,
    bodyColumns: body.columns,
    bodyRows: body.rows,
    now: 0,
  };
}

/** Feeds keys and the reads they ask for (answered from presetJson), without touching disk. */
function drive(model: PresetsModel, ctx: Ctx, ...keys: string[]): PresetsModel {
  let current = model;
  const answer = (msgs: AppMsg[]) => {
    for (const msg of msgs) {
      if (msg.type !== "tab") continue;
      const inner = msg.msg as TabMsg;
      if (inner.type !== "presets/read") continue;
      const found = PRESETS.find((p) => p.path === inner.path);
      const reply = found
        ? {
            type: "presets/read",
            path: inner.path,
            preset: presetJson(found.name, found.printer, found.filamentId),
          }
        : { type: "presets/read", path: inner.path, error: "Couldn't read it" };
      current = presetsTab.update(current, reply, ctx)[0];
    }
  };
  const reads = (path: string | undefined): AppMsg[] =>
    path ? [{ type: "tab", tab: "presets", msg: { type: "presets/read", path } }] : [];
  for (const key of keys) {
    const before = current;
    current = presetsTab.update(current, { type: "key", key: press(key) }, ctx)[0];
    // A read was asked for when a preset is now loading or opening.
    const opening = current.opening?.path;
    const loading = [...current.files].find(([, f]) => f.state === "loading")?.[0];
    if (opening && opening !== before.opening?.path) answer(reads(opening));
    if (loading) answer(reads(loading));
  }
  return current;
}

function start(ctx: Ctx): PresetsModel {
  const [model] = presetsTab.init(ctx, { query: "" });
  const first = PRESETS.find((p) => model.files.has(p.path));
  return first
    ? presetsTab.update(
        model,
        {
          type: "presets/read",
          path: first.path,
          preset: presetJson(first.name, first.printer, first.filamentId),
        },
        ctx,
      )[0]
    : model;
}

function lines(model: PresetsModel, ctx: Ctx): string[] {
  const out = renderToString(
    <ThemeProvider theme={theme}>
      <presetsTab.View model={model} ctx={ctx} />
    </ThemeProvider>,
    { columns: ctx.bodyColumns },
  );
  return stripVTControlCharacters(out).split("\n");
}

function expectExact(screen: string[], ctx: Ctx): void {
  expect(screen).toHaveLength(ctx.bodyRows);
  for (const [index, line] of screen.entries())
    expect(textWidth(line), `line ${index}: ${line}`).toBe(ctx.bodyColumns);
}

beforeEach(() => {
  vi.stubEnv("HOME", HOME);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each([
  [80, 24],
  [120, 36],
])("at %ix%i", (columns, rows) => {
  const ctx = ctxFor(columns, rows);

  it("fills the body with the list and the highlighted preset's detail", () => {
    const screen = lines(start(ctx), ctx);
    expectExact(screen, ctx);
    const text = screen.join("\n");
    expect(screen[0]).toMatch(/^╭ Presets · 4 filaments \(5 presets\) in folder default ─/);
    expect(text).toMatch(/Sunlu PETG 2\.0 Vivid Yellow +X1C (0\.4(, |\/)0\.6|×2)/);
    expect(text.match(/Sunlu PETG 2\.0 Vivid Yellow/g)).toHaveLength(1);
    expect(text).toMatch(/OVERTURE ROCK PLA +BBL X1C +no ID/);
    expect(text).toContain("Polymaker PolyLite™ PETG Galaxy Dark Blue With A Lo");
    expect(text).not.toContain("X1 Carbon");
    expect(text).toMatch(/Nozzle +255°C/);
    expect(text).toMatch(/Printer +X1C 0\.4/);
  });

  it("picks the printer of a filament with left and right, shown in the detail", () => {
    const sunlu = drive(start(ctx), ctx, "s", "right");
    const screen = lines(sunlu, ctx);
    expectExact(screen, ctx);
    const text = screen.join("\n");
    expect(text).toMatch(/Printer +‹ X1C 0\.6 › +2 of 2/);
    expect(text).toContain("P4840583");
  });

  it("points a preset without an ID at Check", () => {
    const rock = drive(start(ctx), ctx, "o");
    const text = lines(rock, ctx).join("\n");
    expect(text).toMatch(/Filament ID +none: f fixes it in Check/);
  });

  it("shows the filter, its matches, and a draft's marker", () => {
    const filtered = drive(start(ctx), ctx, "/", "r", "o", "c", "k");
    const screen = lines(filtered, ctx);
    expectExact(screen, ctx);
    expect(screen[0]).toMatch(/^╭ Presets · 1 of 4 ─/);
    expect(screen[1]).toMatch(/^│ \/ rock/);
    const drafted = drive(start(ctx), ctx, "enter", "enter", "backspace", "0", "enter", "esc");
    const text = lines(drafted, ctx).join("\n");
    expect(text).toContain("edited");
    expect(text).toMatch(/Unsaved +1 change, enter to go on/);
  });

  it("shows the editor's pages, a changed value with what it was, and what a field takes", () => {
    const editor = drive(
      start(ctx),
      ctx,
      "s",
      "enter",
      "down",
      "down",
      "down",
      "enter",
      "backspace",
      "backspace",
      "backspace",
      "2",
      "5",
      "5",
      "enter",
    );
    const screen = lines(editor, ctx);
    expectExact(screen, ctx);
    const text = screen.join("\n");
    expect(screen[0]).toMatch(/^╭ Edit Sunlu PETG 2.0 Vivid Yellow · X1C 0.4 ─/);
    expect(screen[1]).toContain("▸ Nozzle 1 ─ Bed ─ Flow");
    expect(screen[1]).toContain("All settings");
    expect(text).toMatch(/Nozzle range, high +255 °C +was 270 °C/);
    expect(text).toContain("Takes");
    expect(text).toContain("whole number, 0–500");
    expect(text).toMatch(/1 change · 4\/4 ─╯/);
  });

  it("shows a value being typed and why it doesn't fit", () => {
    const typing = drive(start(ctx), ctx, "s", "enter", "enter", "x", "enter");
    const text = lines(typing, ctx).join("\n");
    expect(text).toContain("255x");
    expect(text).toContain("✗ Nozzle: type a whole number from 0 to 500");
  });

  it("lists every key on All settings, filtered", () => {
    const all = drive(
      start(ctx),
      ctx,
      "s",
      "enter",
      ...Array(6).fill("right"),
      "/",
      "v",
      "e",
      "n",
      "d",
    );
    const screen = lines(all, ctx);
    expectExact(screen, ctx);
    expect(screen[1]).toContain("▸ All settings");
    expect(screen[2]).toMatch(/^│ \/ vend/);
    expect(screen.join("\n")).toMatch(/filament_vendor +Sunlu/);
  });

  it("reviews the change, the presets it goes into, and the notes", () => {
    const review = drive(start(ctx), ctx, "s", "enter", "enter", "backspace", "0", "enter", "a");
    const screen = lines(review, ctx);
    expectExact(screen, ctx);
    const text = screen.join("\n");
    expect(screen[0]).toMatch(/^╭ Save changes · Sunlu PETG 2.0 Vivid Yellow @ X1C 0.4 ─/);
    expect(text).toMatch(/Nozzle +255 °C → 250 °C/);
    expect(text).toContain("Into 2 presets of Sunlu PETG 2.0 Vivid Yellow");
    expect(text).toMatch(/\[✓\] X1C 0\.4 +the one you edited/);
    expect(text).toMatch(/\[✓\] X1C 0\.6 +same filament ID/);
    expect(text).toContain("Close BambuStudio first");
  });

  it("shows each preset's result once saved", () => {
    const review = drive(start(ctx), ctx, "s", "enter", "enter", "backspace", "0", "enter", "a");
    const [saving] = presetsTab.update(review, { type: "key", key: press("a") }, ctx);
    const target = PRESETS[0]?.path ?? "";
    const other = PRESETS[1]?.path ?? "";
    const [done] = presetsTab.update(
      saving,
      {
        type: "presets/saved",
        path: target,
        results: [
          { path: target, ok: true, detail: "" },
          { path: other, ok: false, detail: "couldn't write it: EACCES" },
        ],
        spoolease: null,
        setupError: false,
      },
      ctx,
    );
    const screen = lines(done, ctx);
    expectExact(screen, ctx);
    const text = screen.join("\n");
    expect(screen[0]).toMatch(/^╭ Saved · /);
    expect(text).toContain("✓ saved");
    expect(text).toContain("✗ couldn't write it: EACCES");
    expect(text).toContain("✗ 1 preset saved, 1 failed: restart BambuStudio to load them");
  });
});

it("says where to look when the folder has no presets of its own", () => {
  const ctx = ctxFor(80, 24);
  const empty: Ctx = {
    ...ctx,
    resources: {
      ...ctx.resources,
      presets: { state: "ready", value: { presets: [], warnings: [] }, at: 0 },
    },
  };
  const screen = lines(presetsTab.init(empty, { query: "" })[0], empty);
  expectExact(screen, empty);
  expect(screen.join("\n")).toContain("No filament presets of your own yet");
});
