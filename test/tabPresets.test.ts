// ABOUTME: Tests for the Presets tab's model: the list, its detail data, drafts, the review and saving to presets and SpoolEase.
// ABOUTME: Drives update() with press() keys and runs its commands against real files and the SpoolEase stand-in.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Preset } from "../src/presetEdit.js";
import type { UserPreset } from "../src/syncCheck.js";
import { type KeyPress, press } from "../src/tui/core/keys.js";
import type { Cmd } from "../src/tui/core/program.js";
import type { AppMsg, Ctx, Resource, Resources, TabMsg } from "../src/tui/core/types.js";
import type { FormValues } from "../src/tui/core/values.js";
import {
  compactDetail,
  listColumns,
  presetDetail,
  presetGroups,
  presetRows,
  printersText,
  statusCells,
} from "../src/tui/tabs/presets/detail.js";
import { ALL_SETTINGS } from "../src/tui/tabs/presets/editor.js";
import { presetsTab } from "../src/tui/tabs/presets/index.js";
import {
  capturesText,
  commands,
  hints,
  init,
  type PresetsModel,
  update,
  visiblePresets,
} from "../src/tui/tabs/presets/model.js";
import {
  type SpoolEaseServer,
  startSpoolEaseServer,
  TEST_SECURITY_KEY,
} from "./spooleaseServer.js";

const X1C_04 = "Bambu Lab X1 Carbon 0.4 nozzle";
const X1C_06 = "Bambu Lab X1 Carbon 0.6 nozzle";

function presetJson(name: string, printer: string, id: string): Preset {
  return {
    name: `${name} @${printer}`,
    filament_id: id,
    inherits: "",
    nozzle_temperature: ["220"],
    nozzle_temperature_initial_layer: ["225"],
    nozzle_temperature_range_low: ["190"],
    nozzle_temperature_range_high: ["240"],
    textured_plate_temp: ["55"],
    hot_plate_temp: ["60"],
    cool_plate_temp: ["0"],
    filament_flow_ratio: ["0.98"],
    filament_max_volumetric_speed: ["21"],
    fan_min_speed: ["30"],
    fan_max_speed: ["80"],
    filament_density: ["1.24"],
    filament_cost: ["25"],
    default_filament_colour: ["#AD0000"],
    compatible_printers: [printer],
  };
}

let dir: string;
let presets: UserPreset[];

async function writePreset(file: string, preset: Preset): Promise<string> {
  const path = join(dir, file);
  await writeFile(path, `${JSON.stringify(preset, null, 4)}\n`);
  return path;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "tab-presets-"));
  presets = [
    {
      name: "Acme PLA Red",
      printer: X1C_04,
      filamentId: "P1111111",
      path: await writePreset("red04.json", presetJson("Acme PLA Red", X1C_04, "P1111111")),
    },
    {
      name: "Bolt PETG Blue",
      printer: X1C_04,
      filamentId: "",
      path: await writePreset("blue.json", presetJson("Bolt PETG Blue", X1C_04, "")),
    },
    {
      name: "Acme PLA Red",
      printer: X1C_06,
      filamentId: "P1111111",
      path: await writePreset("red06.json", presetJson("Acme PLA Red", X1C_06, "P1111111")),
    },
    {
      name: "Acme ABS Black",
      printer: X1C_04,
      filamentId: "P2222222",
      path: await writePreset("black.json", presetJson("Acme ABS Black", X1C_04, "P2222222")),
    },
  ];
});

const VALUES: FormValues = {
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
};

function ready<T>(value: T): Resource<T> {
  return { state: "ready", value, at: 0 };
}

function ctxWith(
  list: UserPreset[] | null = presets,
  values: Partial<FormValues> = {},
  resources: Partial<Resources> = {},
): Ctx {
  return {
    values: { ...VALUES, ...values },
    resources: {
      console: { state: "idle" },
      presets: list ? ready({ presets: list, warnings: [] }) : { state: "loading" },
      catalog: { state: "idle" },
      check: { state: "idle" },
      ...resources,
    },
    columns: 100,
    rows: 30,
    bodyColumns: 100,
    bodyRows: 28,
    now: 0,
  };
}

/** Runs commands, feeding the tab's own messages back into update until nothing is left; returns app messages. */
async function settle(
  model: PresetsModel,
  ctx: Ctx,
  cmds: Cmd<AppMsg>[],
): Promise<{ model: PresetsModel; sent: AppMsg[] }> {
  const sent: AppMsg[] = [];
  let current = model;
  let queue = cmds;
  while (queue.length > 0) {
    const msgs: AppMsg[] = [];
    for (const cmd of queue) await cmd((msg) => msgs.push(msg));
    queue = [];
    for (const msg of msgs) {
      if (msg.type === "tab" && msg.tab === "presets") {
        const [next, more] = update(current, msg.msg, ctx);
        current = next;
        queue.push(...more);
      } else sent.push(msg);
    }
  }
  return { model: current, sent };
}

/** Sends keys (or tab messages) one at a time, settling each one's commands. */
async function drive(
  model: PresetsModel,
  ctx: Ctx,
  ...inputs: (KeyPress | string | TabMsg)[]
): Promise<{ model: PresetsModel; sent: AppMsg[] }> {
  let current = model;
  const sent: AppMsg[] = [];
  for (const input of inputs) {
    const msg: AppMsg | TabMsg =
      typeof input === "string"
        ? { type: "key", key: press(input) }
        : "name" in input || "input" in input
          ? { type: "key", key: input as KeyPress }
          : (input as TabMsg);
    const [next, cmds] = update(current, msg, ctx);
    const settled = await settle(next, ctx, cmds);
    current = settled.model;
    sent.push(...settled.sent);
  }
  return { model: current, sent };
}

async function start(ctx: Ctx = ctxWith()): Promise<{ model: PresetsModel; sent: AppMsg[] }> {
  const [model, cmds] = init(ctx, { query: "" });
  return settle(model, ctx, cmds);
}

describe("presetRows", () => {
  it("keeps presets sharing a filament ID together, groups by name, printers in order", () => {
    expect(presetRows(presets, "").map((p) => p.path.split("/").pop())).toEqual([
      "black.json",
      "red04.json",
      "red06.json",
      "blue.json",
    ]);
  });

  it("filters by every word in the name, printer or ID, with 'no ID' for presets without one", () => {
    const files = (filter: string) =>
      presetRows(presets, filter).map((p) => p.path.split("/").pop());
    expect(files("red 0.6")).toEqual(["red06.json"]);
    expect(files("p2222")).toEqual(["black.json"]);
    expect(files("no id")).toEqual(["blue.json"]);
  });
});

describe("presetGroups", () => {
  it("makes one row per filament: presets sharing a filament ID and name, printers in order", () => {
    const groups = presetGroups(presets, "");
    expect(groups.map((g) => [g.name, g.presets.map((p) => p.path.split("/").pop())])).toEqual([
      ["Acme ABS Black", ["black.json"]],
      ["Acme PLA Red", ["red04.json", "red06.json"]],
      ["Bolt PETG Blue", ["blue.json"]],
    ]);
  });

  it("keeps presets without an ID apart, even with one name, and groups only the filter's matches", () => {
    const twins: UserPreset[] = [
      { name: "Rock", printer: "BBL X1", filamentId: "", path: "/a.json" },
      { name: "Rock", printer: "BBL X1C", filamentId: "", path: "/b.json" },
    ];
    expect(presetGroups(twins, "").map((g) => g.presets.length)).toEqual([1, 1]);
    expect(presetGroups(presets, "red 0.6").map((g) => g.presets.map((p) => p.printer))).toEqual([
      [X1C_06],
    ]);
  });

  it("finds presets by their short printer name too", () => {
    expect(presetRows(presets, "x1c 0.6").map((p) => p.path.split("/").pop())).toEqual([
      "red06.json",
    ]);
  });
});

describe("printersText", () => {
  it("names printers short, a model's nozzles once", () => {
    expect(printersText([X1C_04, X1C_06])).toBe("X1C 0.4, 0.6");
    expect(printersText([X1C_04, "Bambu Lab P1S 0.4 nozzle", X1C_06])).toBe(
      "X1C 0.4, 0.6 · P1S 0.4",
    );
    expect(printersText(["BBL X1C"])).toBe("BBL X1C");
    expect(printersText([X1C_04, X1C_06], 11)).toBe("X1C 0.4/0.6");
    expect(printersText([X1C_04, X1C_06], 7)).toBe("X1C ×2");
    expect(printersText([""])).toBe("any");
  });
});

describe("listColumns", () => {
  const row = (name: string, id = "P1234567", edited = false) => ({
    name,
    printers: "X1C 0.4, 0.6",
    edited,
    id,
  });

  it("shows every column when the names fit, saying no ID in the ID column", () => {
    const widths = listColumns(80, [row("Acme PLA Red"), row("Bolt PETG", "")]);
    expect(widths).toEqual({ printers: 12, status: 0, id: 8 });
    expect(statusCells(row("Bolt PETG", ""), widths)).toEqual({ status: "", id: "no ID" });
    const edited = listColumns(80, [row("Acme PLA Red", "P1234567", true)]);
    expect(edited).toEqual({ printers: 12, status: 6, id: 8 });
    expect(statusCells(row("Acme", "P1", true), edited)).toEqual({ status: "edited", id: "P1" });
  });

  it("drops the ID, then shrinks the printers, before a name is cut; no ID moves to status", () => {
    const long = "Polymaker PolyLite PETG Galaxy Dark Blue"; // 40 columns
    expect(listColumns(64, [row(long, "P1234567", true)])).toEqual({
      printers: 12,
      status: 6,
      id: 0,
    });
    expect(listColumns(58, [row(long, "")])).toEqual({ printers: 8, status: 6, id: 0 });
    expect(statusCells(row(long, ""), { id: 0 })).toEqual({ status: "no ID", id: "" });
    expect(listColumns(56, [row(long)])).toEqual({ printers: 12, status: 0, id: 0 });
    expect(listColumns(40, [row(long, "", true)])).toEqual({ printers: 7, status: 6, id: 0 });
  });
});

describe("presetDetail", () => {
  it("shows the color and the key settings people check, with units", () => {
    const detail = presetDetail(presetJson("Acme PLA Red", X1C_04, "P1111111"));
    expect(detail.swatch).toBe("#AD0000");
    expect(detail.rows).toEqual([
      { label: "Nozzle", value: "220°C · first layer 225°C" },
      { label: "Range", value: "190–240°C" },
      { label: "Textured PEI", value: "55°C" },
      { label: "Smooth PEI", value: "60°C" },
      { label: "Flow ratio", value: "0.98" },
      { label: "Max flow", value: "21 mm³/s" },
      { label: "Fan", value: "30–80%" },
      { label: "Density", value: "1.24 g/cm³" },
      { label: "Cost", value: "25 per kg" },
    ]);
  });

  it("leaves out what the preset doesn't set, and shows variants that differ", () => {
    const detail = presetDetail({
      nozzle_temperature: ["220", "230"],
      filament_colour: ["#00FF00"],
    });
    expect(detail).toEqual({
      swatch: "#00FF00",
      rows: [{ label: "Nozzle", value: "220 / 230°C" }],
    });
    expect(presetDetail({})).toEqual({ rows: [] });
    expect(
      presetDetail({ fan_min_speed: ["100"], fan_max_speed: ["100"], filament_cost: ["0"] }),
    ).toEqual({ rows: [{ label: "Fan", value: "100%" }] });
  });
});

describe("compactDetail", () => {
  it("fits the key settings in four lines for a narrow terminal", () => {
    expect(compactDetail(presetJson("Acme PLA Red", X1C_04, "P1111111"))).toEqual([
      { label: "Nozzle", value: "220°C · first 225°C · range 190–240°C" },
      { label: "Bed", value: "Textured 55°C · Smooth 60°C" },
      { label: "Flow", value: "ratio 0.98 · max 21 mm³/s · fan 30–80%" },
      { label: "Filament", value: "1.24 g/cm³ · 25 per kg" },
    ]);
    expect(compactDetail({ nozzle_temperature: ["220"] })).toEqual([
      { label: "Nozzle", value: "220°C" },
    ]);
  });
});

describe("list", () => {
  it("asks for the presets and reads the highlighted one for its detail", async () => {
    const { model, sent } = await start();
    expect(sent).toEqual([{ type: "app/load", resource: "presets" }]);
    expect(model.path).toBe(presets[3]?.path);
    expect(model.files.get(presets[3]?.path ?? "")).toMatchObject({ state: "ready" });
  });

  it("reads a preset once when highlighted, then keeps it", async () => {
    const ctx = ctxWith();
    const { model } = await drive((await start(ctx)).model, ctx, "down", "right");
    expect(model.path).toBe(presets[2]?.path);
    expect([...model.files.keys()]).toHaveLength(3);
    const [, cmds] = update(model, { type: "key", key: press("left") }, ctx);
    expect(cmds).toEqual([]);
  });

  it("shows why a preset couldn't be read", async () => {
    await writeFile(presets[3]?.path ?? "", "not json");
    const { model } = await start();
    const file = model.files.get(presets[3]?.path ?? "");
    expect(file?.state).toBe("failed");
    expect(file && "error" in file ? file.error : "").toMatch(/^Couldn't read black\.json: /);
    await writeFile(presets[3]?.path ?? "", "[1]");
    const again = await start();
    expect(again.model.files.get(presets[3]?.path ?? "")).toEqual({
      state: "failed",
      error: "Couldn't read black.json: it isn't a preset",
    });
  });

  it("waits for the presets, then highlights the first", async () => {
    const loading = ctxWith(null);
    const { model } = await start(loading);
    expect(model.path).toBeUndefined();
    const loaded = ctxWith();
    const { model: next } = await drive(model, loaded, {
      type: "app/loaded",
      resource: "presets",
      result: loaded.resources.presets,
    } as unknown as TabMsg);
    expect(next.path).toBe(presets[3]?.path);
    expect(next.files.get(presets[3]?.path ?? "")?.state).toBe("ready");
  });

  it("filters with /, typing every key into the filter, keeping the highlight when it's still listed", async () => {
    const ctx = ctxWith();
    const at = (await drive((await start(ctx)).model, ctx, "down", "right")).model;
    const filtering = (await drive(at, ctx, "/")).model;
    expect(capturesText(filtering)).toBe(true);
    const typed = (await drive(filtering, ctx, "red", "space", "0.6")).model;
    expect(typed.filter.text.value).toBe("red 0.6");
    expect(visiblePresets(typed, ctx).map((p) => p.path)).toEqual([presets[2]?.path]);
    expect(typed.path).toBe(presets[2]?.path);
    const question = (await drive(filtering, ctx, "?q")).model;
    expect(question.filter.text.value).toBe("?q");
    const cleared = (await drive(typed, ctx, "esc")).model;
    expect(cleared.filter).toEqual({ text: { value: "", cursor: 0 }, focused: false });
    expect(capturesText(cleared)).toBe(false);
    expect(visiblePresets(cleared, ctx)).toHaveLength(4);
  });

  it("highlights the first match when the highlighted preset is filtered out", async () => {
    const ctx = ctxWith();
    const { model } = await drive((await start(ctx)).model, ctx, "/", "bolt");
    expect(model.path).toBe(presets[1]?.path);
    expect(model.files.get(presets[1]?.path ?? "")?.state).toBe("ready");
  });

  it("keeps the filter with enter, leaving the field; enter again opens, esc then clears", async () => {
    const ctx = ctxWith();
    const kept = (await drive((await start(ctx)).model, ctx, "/", "acme", "enter")).model;
    expect(kept.view).toBe("list");
    expect(kept.filter).toEqual({ text: { value: "acme", cursor: 4 }, focused: false });
    expect(capturesText(kept)).toBe(false);
    const opened = (await drive(kept, ctx, "enter")).model;
    expect(opened.view).toBe("editor");
    const back = (await drive(opened, ctx, "esc")).model;
    expect(back.view).toBe("list");
    expect(back.filter).toEqual({ text: { value: "acme", cursor: 4 }, focused: false });
    expect((await drive(back, ctx, "esc")).model.filter.text.value).toBe("");
  });

  it("moves a filament at a time, keeping the printer, and picks the printer with left and right", async () => {
    const ctx = ctxWith();
    const red = (await drive((await start(ctx)).model, ctx, "down")).model;
    expect(red.path).toBe(presets[0]?.path);
    const red06 = (await drive(red, ctx, "right")).model;
    expect(red06.path).toBe(presets[2]?.path);
    expect(red06.files.get(presets[2]?.path ?? "")?.state).toBe("ready");
    expect((await drive(red06, ctx, "right")).model.path).toBe(presets[2]?.path);
    expect((await drive(red06, ctx, "left")).model.path).toBe(presets[0]?.path);
    expect((await drive(red06, ctx, "down")).model.path).toBe(presets[1]?.path);
    expect((await drive(red06, ctx, "down", "up")).model.path).toBe(presets[0]?.path);
  });

  it("opens the printer's preset: enter edits the one left and right picked", async () => {
    const ctx = ctxWith();
    const { model } = await drive((await start(ctx)).model, ctx, "down", "right", "enter");
    expect(model.editor?.preset.path).toBe(presets[2]?.path);
  });

  it("sends a preset without an ID to Check's list of them with f, and reloads with r", async () => {
    const ctx = ctxWith();
    const started = (await start(ctx)).model;
    expect((await drive(started, ctx, "f")).sent).toEqual([]);
    const blue = (await drive(started, ctx, "b")).model;
    expect((await drive(blue, ctx, "f")).sent).toEqual([
      { type: "app/switchTab", tab: "check", focus: "presetsNoId" },
    ]);
    expect((await drive(started, ctx, "r")).sent).toEqual([
      { type: "app/load", resource: "presets", force: true },
    ]);
  });

  it("goes to Add with enter when there are no presets yet", async () => {
    const ctx = ctxWith([]);
    const { sent } = await drive((await start(ctx)).model, ctx, "enter");
    expect(sent).toContainEqual({ type: "app/switchTab", tab: "add" });
  });

  it("jumps to the next preset starting with a typed letter", async () => {
    const ctx = ctxWith();
    const { model } = await drive((await start(ctx)).model, ctx, "b");
    expect(model.path).toBe(presets[1]?.path);
  });

  it("clears its read cache when the presets reload, and keeps the highlighted preset", async () => {
    const ctx = ctxWith();
    const at = (await drive((await start(ctx)).model, ctx, "down")).model;
    await writeFile(
      at.path ?? "",
      JSON.stringify({ ...presetJson("x", X1C_04, "P1"), nozzle_temperature: ["199"] }),
    );
    const { model } = await drive(at, ctx, {
      type: "app/loaded",
      resource: "presets",
      result: ctx.resources.presets,
    } as unknown as TabMsg);
    expect(model.path).toBe(presets[0]?.path);
    expect([...model.files.keys()]).toEqual([presets[0]?.path]);
    const file = model.files.get(presets[0]?.path ?? "");
    expect(file && "preset" in file ? file.preset.nozzle_temperature : null).toEqual(["199"]);
  });
});

describe("editing", () => {
  it("opens the highlighted preset in the editor, read fresh, and keeps unsaved edits as a draft", async () => {
    const ctx = ctxWith();
    const opened = (await drive((await start(ctx)).model, ctx, "enter")).model;
    expect(opened.view).toBe("editor");
    expect(opened.editor?.preset.path).toBe(presets[3]?.path);
    expect(opened.editor?.model.mode).toBe("preset");
    const edited = (await drive(opened, ctx, "enter", "225", "enter")).model;
    expect(capturesText(edited)).toBe(false);
    const left = (await drive(edited, ctx, "esc")).model;
    expect(left.view).toBe("list");
    expect(left.editor).toBeNull();
    expect(left.drafts.get(presets[3]?.path ?? "")).toEqual(
      new Map([["nozzle_temperature", { every: "225" }]]),
    );
    const again = (await drive(left, ctx, "enter")).model;
    expect(again.editor?.model.edits.get("nozzle_temperature")).toEqual({ every: "225" });
    const undone = (await drive(again, ctx, "u", "esc")).model;
    expect(undone.drafts.size).toBe(0);
  });

  it("doesn't open a preset when the highlight moved on before it was read", async () => {
    const ctx = ctxWith();
    const started = (await start(ctx)).model;
    const [opening, cmds] = update(started, { type: "key", key: press("enter") }, ctx);
    const [moved, more] = update(opening, { type: "key", key: press("down") }, ctx);
    const { model } = await settle(moved, ctx, [...cmds, ...more]);
    expect(model.view).toBe("list");
    expect(model.editor).toBeNull();
    expect(model.path).toBe(presets[0]?.path);
  });

  it("passes every key to a value being typed, including ? and q", async () => {
    const ctx = ctxWith();
    const typing = (await drive((await start(ctx)).model, ctx, "enter", "enter")).model;
    expect(capturesText(typing)).toBe(true);
    expect(hints(typing, ctx).map((h) => h.keys)).toEqual(["←→", "shift+←→", "enter", "esc"]);
    const { model } = await drive(typing, ctx, "?q");
    expect(model.editor?.model.text?.value).toBe("?q");
  });

  it("takes a paste into the value being typed", async () => {
    const ctx = ctxWith();
    const typing = (await drive((await start(ctx)).model, ctx, "enter", "enter", "home")).model;
    const [pasted] = update(typing, { type: "paste", text: "1" }, ctx);
    expect(pasted.editor?.model.text?.value).toBe("1220");
  });

  it("doesn't open a preset it can't read, and says why in the detail", async () => {
    const ctx = ctxWith();
    const started = (await start(ctx)).model;
    await rm(presets[3]?.path ?? "");
    const { model } = await drive(started, ctx, "enter");
    expect(model.view).toBe("list");
    expect(model.files.get(presets[3]?.path ?? "")?.state).toBe("failed");
  });

  it("opens a preset from the command palette, switching to the tab", async () => {
    const ctx = ctxWith();
    const started = (await start(ctx)).model;
    const open = commands(started, ctx).find((c) => c.title === "Edit Acme PLA Red @ X1C 0.6");
    expect(open?.msg).toEqual({
      type: "tab",
      tab: "presets",
      msg: { type: "presets/open", path: presets[2]?.path },
    });
    const msg = (open?.msg as { msg: TabMsg } | undefined)?.msg as TabMsg;
    const { model, sent } = await drive(started, ctx, msg);
    expect(sent).toEqual([{ type: "app/switchTab", tab: "presets" }]);
    expect(model.editor?.preset.path).toBe(presets[2]?.path);
    expect(
      commands(started, ctx)
        .map((c) => c.title)
        .slice(0, 2),
    ).toEqual(["Filter presets", "Edit Acme ABS Black @ X1C 0.4"]);
  });
});

/** Opens Acme PLA Red @0.4 (two presets share its ID) and edits its nozzle range's high end. */
async function editRange(ctx: Ctx, high = "250") {
  const started = (await start(ctx)).model;
  const opened = (await drive(started, ctx, "down", "enter")).model;
  return drive(
    opened,
    ctx,
    "down",
    "down",
    "down",
    "enter",
    "backspace",
    "backspace",
    "backspace",
    high,
    "enter",
  );
}

describe("review", () => {
  it("lists the changes and every preset of the filament, all ticked; space unticks", async () => {
    const ctx = ctxWith();
    const reviewing = (await drive((await editRange(ctx)).model, ctx, "a")).model;
    expect(reviewing.view).toBe("review");
    const review = reviewing.review;
    expect(review?.changes).toEqual([
      {
        key: "nozzle_temperature_range_high",
        label: "Nozzle range, high",
        from: "240°C",
        to: "250°C",
      },
    ]);
    expect(review?.targets.map((t) => t.path)).toEqual([presets[0]?.path, presets[2]?.path]);
    expect([...(review?.ticked ?? [])]).toEqual([presets[0]?.path, presets[2]?.path]);
    expect(review?.range).toEqual({ state: "none" });
    const unticked = (await drive(reviewing, ctx, "down", "space")).model;
    expect([...(unticked.review?.ticked ?? [])]).toEqual([presets[0]?.path]);
    const none = (await drive(unticked, ctx, "up", "space", "a")).model;
    expect(none.review?.error).toBe("Tick at least one preset to save to");
    expect(none.review?.phase).toBe("review");
  });

  it("goes back to the editor with esc, edits intact", async () => {
    const ctx = ctxWith();
    const reviewing = (await drive((await editRange(ctx)).model, ctx, "a")).model;
    const back = (await drive(reviewing, ctx, "esc")).model;
    expect(back.view).toBe("editor");
    expect(back.editor?.model.edits.size).toBe(1);
  });

  it("refuses to review nothing", async () => {
    const ctx = ctxWith();
    const opened = (await drive((await start(ctx)).model, ctx, "enter", "a")).model;
    expect(opened.view).toBe("editor");
    expect(opened.editor?.model.error).toBe("Nothing changed yet");
  });

  it("names the presets' folder state and what saving changes, in hints", async () => {
    const ctx = ctxWith();
    const reviewing = (await drive((await editRange(ctx)).model, ctx, "a")).model;
    expect(hints(reviewing, ctx).map((h) => `${h.keys} ${h.label}`)).toEqual([
      "a save",
      "space tick",
      "esc back",
      "↑↓ move",
    ]);
  });
});

describe("saving", () => {
  let server: SpoolEaseServer;
  let consoleCtx: Ctx;

  beforeEach(async () => {
    server = await startSpoolEaseServer();
    server.customFilaments =
      "P1111111,Acme PLA Red,190,240,PLA\r\nP2222222,Acme ABS Black,240,260,ABS";
    consoleCtx = ctxWith(presets, {
      host: "127.0.0.1",
      port: String(server.port),
      securityKey: TEST_SECURITY_KEY,
      skipSpoolease: false,
    });
  });

  afterEach(async () => {
    await server.close();
  });

  it("writes the ticked presets only, then reports, reloads the presets and clears the draft", async () => {
    const ctx = ctxWith();
    const edited = (await editRange(ctx)).model;
    const reviewing = (await drive(edited, ctx, "a", "down", "space")).model;
    const saving = update(reviewing, { type: "key", key: press("a") }, ctx);
    expect(saving[0].review?.phase).toBe("saving");
    expect(capturesText(saving[0])).toBe(false);
    const { model, sent } = await settle(saving[0], ctx, saving[1]);
    expect(model.review?.phase).toBe("done");
    expect(model.review?.results).toEqual([{ path: presets[0]?.path, ok: true, detail: "" }]);
    expect(model.drafts.size).toBe(0);
    const red04 = JSON.parse(await readFile(presets[0]?.path ?? "", "utf-8"));
    expect(red04.nozzle_temperature_range_high).toEqual(["250"]);
    const red06 = JSON.parse(await readFile(presets[2]?.path ?? "", "utf-8"));
    expect(red06.nozzle_temperature_range_high).toEqual(["240"]);
    expect(sent).toEqual([
      {
        type: "app/runFinished",
        summary: {
          ok: true,
          lines: ["1 BambuStudio preset of Acme PLA Red saved: restart BambuStudio to load"],
        },
      },
      { type: "app/load", resource: "presets", force: true },
      { type: "app/toast", text: "Saved 1 preset of Acme PLA Red", tone: "ok" },
    ]);
    const back = (await drive(model, ctx, "esc")).model;
    expect(back.view).toBe("list");
    expect(back.review).toBeNull();
    expect(back.editor).toBeNull();
  });

  it("ignores keys while saving", async () => {
    const ctx = ctxWith();
    const reviewing = (await drive((await editRange(ctx)).model, ctx, "a")).model;
    const [saving] = update(reviewing, { type: "key", key: press("a") }, ctx);
    const [still, cmds] = update(saving, { type: "key", key: press("esc") }, ctx);
    expect(still).toBe(saving);
    expect(cmds).toEqual([]);
    expect(hints(saving, ctx)).toEqual([]);
  });

  it("reads SpoolEase's nozzle range for the filament and changes it too", async () => {
    const reviewing = (await drive((await editRange(consoleCtx)).model, consoleCtx, "a")).model;
    expect(reviewing.review?.range).toEqual({
      state: "change",
      change: { code: "P1111111", from: "190–240°C", to: "190–250°C", low: 190, high: 250 },
    });
    const { model, sent } = await drive(reviewing, consoleCtx, "a");
    expect(server.customFilaments).toBe(
      "P1111111,Acme PLA Red,190,250,PLA\r\nP2222222,Acme ABS Black,240,260,ABS",
    );
    expect(model.review?.spoolease).toEqual({
      ok: true,
      line: "SpoolEase's nozzle range for P1111111 is 190–250°C",
    });
    expect(sent).toEqual([
      {
        type: "app/runFinished",
        summary: {
          ok: true,
          lines: [
            "2 BambuStudio presets of Acme PLA Red saved: restart BambuStudio to load",
            "SpoolEase's nozzle range for P1111111 is 190–250°C",
          ],
        },
      },
      { type: "app/load", resource: "presets", force: true },
      { type: "app/load", resource: "console", force: true },
      { type: "app/load", resource: "check", force: true },
      { type: "app/toast", text: "Saved 2 presets of Acme PLA Red", tone: "ok" },
    ]);
    expect(JSON.stringify(sent)).not.toContain(TEST_SECURITY_KEY);
  });

  it("leaves SpoolEase alone when its range already matches, or the range didn't change", async () => {
    server.customFilaments = "P1111111,Acme PLA Red,190,250,PLA";
    const same = (await drive((await editRange(consoleCtx)).model, consoleCtx, "a")).model;
    expect(same.review?.range).toEqual({ state: "none" });
    server.requests.length = 0;
    const started = (await start(consoleCtx)).model;
    const other = (
      await drive(started, consoleCtx, "down", "enter", "enter", "backspace", "5", "enter", "a")
    ).model;
    expect(other.review?.range).toEqual({ state: "none" });
    expect(server.requests).toEqual([]);
  });

  it("warns and keeps SpoolEase's range when it can't be read", async () => {
    const ctx = ctxWith(presets, { ...consoleCtx.values, securityKey: "WRONG" });
    const reviewing = (await drive((await editRange(ctx)).model, ctx, "a")).model;
    expect(reviewing.review?.range).toEqual({
      state: "warning",
      warning:
        "Couldn't read SpoolEase, so its nozzle range for P1111111 stays as it is: SpoolEase key validation failed",
    });
    const { sent } = await drive(reviewing, ctx, "a");
    expect(sent[0]).toMatchObject({ type: "app/runFinished", summary: { ok: true } });
    expect(JSON.stringify(sent)).not.toContain("WRONG");
  });

  it("waits for SpoolEase's range before saving", async () => {
    const edited = (await editRange(consoleCtx)).model;
    const [checking, cmds] = update(edited, { type: "key", key: press("a") }, consoleCtx);
    expect(checking.review?.range).toEqual({ state: "checking" });
    const [refused] = update(checking, { type: "key", key: press("a") }, consoleCtx);
    expect(refused.review?.phase).toBe("review");
    expect(refused.review?.error).toBe("Still reading SpoolEase's nozzle range");
    expect(cmds).toHaveLength(1);
  });

  it("reports a preset it couldn't write as a failure, exit code 1", async () => {
    const ctx = ctxWith();
    const reviewing = (await drive((await editRange(ctx)).model, ctx, "a")).model;
    await rm(presets[2]?.path ?? "");
    const { model, sent } = await drive(reviewing, ctx, "a");
    expect(model.review?.results?.map((r) => r.ok)).toEqual([true, false]);
    expect(sent[0]).toEqual({
      type: "app/runFinished",
      summary: {
        ok: false,
        exitCode: 1,
        lines: [
          "1 BambuStudio preset of Acme PLA Red saved, 1 failed: restart BambuStudio to load",
          expect.stringMatching(/^Acme PLA Red @ X1C 0\.6: couldn't read it: /),
        ],
      },
    });
    expect(sent.at(-1)).toEqual({
      type: "app/toast",
      text: "Saved 1 preset of Acme PLA Red, 1 failed",
      tone: "failed",
    });
  });

  it("counts a key SpoolEase rejects while saving its range as a setup error, exit code 2", async () => {
    const reviewing = (await drive((await editRange(consoleCtx)).model, consoleCtx, "a")).model;
    server.replies["POST /api/test-key"] = { status: 401, body: "no" };
    const { model, sent } = await drive(reviewing, consoleCtx, "a");
    expect(model.review?.spoolease).toEqual({
      ok: false,
      line: "Couldn't change SpoolEase's nozzle range: SpoolEase key validation failed",
    });
    expect(sent[0]).toMatchObject({ type: "app/runFinished", summary: { ok: false, exitCode: 2 } });
    expect(sent).not.toContainEqual({ type: "app/load", resource: "console", force: true });
  });

  it("says when SpoolEase no longer lists the filament", async () => {
    const reviewing = (await drive((await editRange(consoleCtx)).model, consoleCtx, "a")).model;
    server.customFilaments = "P2222222,Acme ABS Black,240,260,ABS";
    const { model } = await drive(reviewing, consoleCtx, "a");
    expect(model.review?.spoolease).toEqual({
      ok: false,
      line: "SpoolEase no longer lists P1111111; nothing changed there",
    });
  });
});

describe("hints and modes", () => {
  it("lists the list's keys, with the filter's when it has focus", async () => {
    const ctx = ctxWith();
    const { model } = await start(ctx);
    expect(hints(model, ctx).map((h) => `${h.keys} ${h.label}`)).toEqual([
      "↑↓ move",
      "enter edit",
      "/ filter",
      "a-z jump",
      "r reload",
    ]);
    const red = (await drive(model, ctx, "down")).model;
    expect(hints(red, ctx).map((h) => `${h.keys} ${h.label}`)).toContain("←→ printer");
    const blue = (await drive(model, ctx, "b")).model;
    expect(hints(blue, ctx).map((h) => `${h.keys} ${h.label}`)).toContain("f fix in Check");
    const filtering = (await drive(model, ctx, "/", "x")).model;
    expect(hints(filtering, ctx).map((h) => `${h.keys} ${h.label}`)).toEqual([
      "↑↓ move",
      "enter done",
      "esc clear",
    ]);
    const kept = (await drive(model, ctx, "/", "acme", "enter")).model;
    expect(hints(kept, ctx).map((h) => `${h.keys} ${h.label}`)).toContain("esc clear filter");
  });

  it("uses the editor's hints and text capture while editing", async () => {
    const ctx = ctxWith();
    const opened = (
      await drive((await start(ctx)).model, ctx, "enter", ...Array(ALL_SETTINGS).fill("right"), "/")
    ).model;
    expect(capturesText(opened)).toBe(true);
    expect(hints(opened, ctx).map((h) => h.keys)).toEqual(["↑↓", "enter", "esc"]);
  });
});

describe("contract with the shell", () => {
  it("says it's busy while saving, so q doesn't quit in the middle", async () => {
    const ctx = ctxWith();
    const reviewing = (await drive((await editRange(ctx)).model, ctx, "a")).model;
    expect(presetsTab.busy?.(reviewing)).toBeNull();
    const [saving, cmds] = update(reviewing, { type: "key", key: press("a") }, ctx);
    expect(presetsTab.busy?.(saving)).toBe("Saving 2 presets of Acme PLA Red");
    const { model } = await settle(saving, ctx, cmds);
    expect(presetsTab.busy?.(model)).toBeNull();
  });

  it("counts unsaved changes: drafts, plus the editor's own edits while it's open", async () => {
    const ctx = ctxWith();
    const started = (await start(ctx)).model;
    expect(presetsTab.unsaved?.(started)).toBe(0);
    const edited = (await drive(started, ctx, "enter", "enter", "backspace", "5", "enter")).model;
    expect(presetsTab.unsaved?.(edited)).toBe(1);
    const left = (await drive(edited, ctx, "esc")).model;
    expect(presetsTab.unsaved?.(left)).toBe(1);
    const both = (await drive(left, ctx, "enter", "down", "enter", "backspace", "0", "enter"))
      .model;
    expect(presetsTab.unsaved?.(both)).toBe(2);
    const reviewing = (await editRange(ctx)).model;
    expect(presetsTab.unsaved?.(reviewing)).toBe(1);
    const { model: saved } = await drive(reviewing, ctx, "a", "a");
    expect(saved.review?.phase).toBe("done");
    expect(presetsTab.unsaved?.(saved)).toBe(0);
  });

  it("opens on the preset a deep link names, leaving the editor with its draft kept", async () => {
    const ctx = ctxWith();
    const editing = (
      await drive((await start(ctx)).model, ctx, "enter", "enter", "backspace", "5", "enter")
    ).model;
    const { model } = await drive(editing, ctx, {
      type: "app/switchTab",
      tab: "presets",
      focus: presets[1]?.path,
    } as unknown as TabMsg);
    expect(model.view).toBe("list");
    expect(model.path).toBe(presets[1]?.path);
    expect(model.files.get(presets[1]?.path ?? "")?.state).toBe("ready");
    expect(model.drafts.get(presets[3]?.path ?? "")?.size).toBe(1);
  });

  it("clears a filter that hides the deep-linked preset, and waits for presets still loading", async () => {
    const ctx = ctxWith();
    const filtered = (await drive((await start(ctx)).model, ctx, "/", "acme", "enter")).model;
    const { model } = await drive(filtered, ctx, {
      type: "app/switchTab",
      tab: "presets",
      focus: presets[1]?.path,
    } as unknown as TabMsg);
    expect(model.filter.text.value).toBe("");
    expect(model.path).toBe(presets[1]?.path);

    const loading = ctxWith(null);
    const early = (await start(loading)).model;
    const waiting = (
      await drive(early, loading, {
        type: "app/switchTab",
        tab: "presets",
        focus: presets[2]?.path,
      } as unknown as TabMsg)
    ).model;
    const { model: landed } = await drive(waiting, ctx, {
      type: "app/loaded",
      resource: "presets",
      result: ctx.resources.presets,
    } as unknown as TabMsg);
    expect(landed.path).toBe(presets[2]?.path);
  });

  it("ignores a deep link while saving, and a switch without focus changes nothing", async () => {
    const ctx = ctxWith();
    const reviewing = (await drive((await editRange(ctx)).model, ctx, "a")).model;
    const [saving] = update(reviewing, { type: "key", key: press("a") }, ctx);
    const [still] = update(
      saving,
      { type: "app/switchTab", tab: "presets", focus: presets[1]?.path },
      ctx,
    );
    expect(still).toBe(saving);
    const [same] = update(reviewing, { type: "app/switchTab", tab: "presets" }, ctx);
    expect(same).toBe(reviewing);
  });
});
