// ABOUTME: Tests for the Add tab's Weights, Review and Run/Done pages through update(), with their commands really run.
// ABOUTME: SpoolEase is the local stand-in console; BambuStudio is a temp HOME with the trimmed real system profiles.

import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { press } from "../src/tui/core/keys.js";
import type { Ctx } from "../src/tui/core/types.js";
import type { FormValues } from "../src/tui/core/values.js";
import { type AddModel, init, ticked } from "../src/tui/tabs/add/model.js";
import {
  capturesText,
  commands,
  currentWeightItems,
  hints,
  pageBar,
  update,
} from "../src/tui/tabs/add/update.js";
import { baseFilamentDir, installBambuStudio, X1C_04 } from "./bambuStudioSetup.js";
import {
  SPOOLS_CATALOG,
  type SpoolEaseServer,
  startSpoolEaseServer,
  TEST_SECURITY_KEY,
} from "./spooleaseServer.js";
import { ctx, Driver, fixtureCatalog } from "./tabAddHarness.js";

const tab = { update };

let home: string;
let server: SpoolEaseServer;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "bh-add-"));
  await installBambuStudio(home);
  vi.stubEnv("HOME", home);
  vi.stubEnv("XDG_CONFIG_HOME", join(home, ".config"));
  server = await startSpoolEaseServer();
  server.spoolsCatalog = SPOOLS_CATALOG;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await server.close();
});

function context(values: Partial<FormValues> = {}): Ctx {
  return ctx({
    values: {
      printerPreset: X1C_04,
      skipSpoolease: false,
      host: "127.0.0.1",
      port: String(server.port),
      securityKey: TEST_SECURITY_KEY,
      ...values,
    },
    resources: { catalog: { state: "ready", value: fixtureCatalog(), at: 0 } },
  });
}

function start(values: Partial<FormValues> = {}): Driver<AddModel> {
  const c = context(values);
  const [model, cmds] = init(c, { query: "" });
  return new Driver(tab, model, c, cmds);
}

/** Ticks every catalog match of each search, then leaves the search. */
function tick(d: Driver<AddModel>, ...searches: string[]): Driver<AddModel> {
  for (const search of searches)
    d.key(press("/"), press(search), press("a", { ctrl: true }), press("esc"));
  return d;
}

const names = (d: Driver<AddModel>) => ticked(d.model, d.context).map((e) => e.profile.name);

describe("weights", () => {
  it("asks for brands SpoolEase's lists don't settle, then reviews with the chosen weights", async () => {
    const d = tick(start(), "polylite", "punkfil");
    expect(names(d)).toEqual(["Polymaker PolyLite™ PETG Black", "RatRig ABS Punkfil Brute Black"]);
    d.key(press("right"));
    expect(d.model.page).toBe("weights");
    expect(d.model.weights.state).toBe("loading");
    await d.settle();
    expect(d.model.weights.state).toBe("ready");
    expect(d.model.weights.prompts.map((g) => g.brand)).toEqual(["Polymaker"]);
    expect(currentWeightItems(d.model).map((i) => i.weight)).toEqual([
      "137 g",
      "149 g",
      "220 g",
      "245 g",
      "139 g",
      "147 g",
      "140 g",
      "–",
    ]);
    expect(currentWeightItems(d.model).at(-2)?.label).toBe("As listed in SpoolmanDB");

    d.key(press("home"), press("down"), press("down"), press("enter"));
    expect(d.model.page).toBe("review");
    await d.settle();
    expect(d.model.review.state).toBe("ready");
    expect(d.model.review.profiles.map((p) => p.coreWeight)).toEqual([220, 220]);
    expect(d.model.review.plans).toEqual([
      {
        presets: 1,
        existingPresets: 0,
        nozzleRange: { low: 230, high: 240 },
        filament: { state: "new", listed: "", becomes: "" },
        spool: "create",
      },
      {
        presets: 1,
        existingPresets: 0,
        nozzleRange: { low: 245, high: 245 },
        filament: { state: "new", listed: "", becomes: "" },
        spool: "create",
      },
    ]);
  });

  it("goes back a brand or to Find, and remembers the choice when coming back", async () => {
    const d = tick(start(), "polylite");
    d.key(press("right"));
    await d.settle();
    d.key(press("end"), press("enter"));
    await d.settle();
    d.key(press("left"));
    expect(d.model.page).toBe("weights");
    expect(d.model.weights.cursor).toBe(7);
    d.key(press("esc"));
    expect(d.model.page).toBe("find");
    const reads = server.requests.filter((r) => r.path === "/spools-catalog").length;
    d.key(press("right"));
    expect(d.model.page).toBe("weights");
    expect(d.model.weights.cursor).toBe(7);
    expect(server.requests.filter((r) => r.path === "/spools-catalog")).toHaveLength(reads);
  });

  it("goes straight to Review when no brand needs a choice, showing Weights as not needed", async () => {
    const d = tick(start(), "punkfil");
    d.key(press("right"));
    await d.settle();
    expect(d.model.page).toBe("review");
    expect(d.model.review.profiles[0]?.coreWeight).toBe(220);
    expect(pageBar(d.model, d.context).map((p) => [p.title, p.state])).toEqual([
      ["Find", "done"],
      ["Weights", "disabled"],
      ["Review", "current"],
      ["Done", "todo"],
    ]);
  });

  it("is skipped when spools aren't created", async () => {
    const d = tick(start({ createSpools: false }), "polylite");
    expect(pageBar(d.model, d.context)[1]?.state).toBe("disabled");
    d.key(press("right"));
    expect(d.model.page).toBe("review");
    await d.settle();
    expect(server.requests.some((r) => r.path === "/spools-catalog")).toBe(false);
  });

  it("says when the console refuses the key, offering Settings and another try", async () => {
    const d = tick(start({ securityKey: "WRONG" }), "polylite");
    d.key(press("right"));
    await d.settle();
    expect(d.model.weights).toMatchObject({ state: "failed", keyRejected: true });
    expect(d.model.weights.error).toBe("SpoolEase key validation failed");
    expect(hints(d.model, d.context).map((h) => h.keys)).toEqual(["r", "s", "esc"]);
    d.key(press("s"));
    await d.settle();
    expect(d.of("app/switchTab")).toEqual([
      { type: "app/switchTab", tab: "settings", focus: "spoolease.key" },
    ]);
    d.context = context();
    d.key(press("r"));
    await d.settle();
    expect(d.model.weights.state).toBe("ready");
  });
});

describe("review", () => {
  it("shows the plan without SpoolEase when it's skipped, and refuses a run the settings can't make", async () => {
    const d = tick(start({ skipSpoolease: true, printerPreset: "" }), "polylite");
    d.key(press("right"));
    await d.settle();
    expect(d.model.review.plans?.[0]).toMatchObject({ presets: 0, filament: null, spool: null });
    d.key(press("a"));
    expect(d.model.page).toBe("review");
    expect(d.model.review.error).toBe("Choose at least one printer in Settings");
    d.key(press("down"));
    expect(d.model.review.error).toBe("");
  });

  it("warns, and plans without the console, when SpoolEase can't be read", async () => {
    const d = tick(start({ createSpools: false, securityKey: "WRONG" }), "polylite");
    d.key(press("right"));
    await d.settle();
    expect(d.model.review.warnings).toEqual([
      "Couldn't read SpoolEase to show what the run changes there: SpoolEase key validation failed",
    ]);
    expect(d.model.review.plans?.[0]?.filament).toBeNull();
  });

  it("waits for the plan before applying", () => {
    const d = tick(start({ createSpools: false }), "polylite");
    d.key(press("right"), press("a"));
    expect(d.model.page).toBe("review");
    expect(d.model.notice).toMatch(/still being read/);
  });

  it("reads the plan again for new edits, dropping a stale reply", async () => {
    const d = tick(start({ createSpools: false }), "polylite");
    d.key(press("right"));
    await d.settle();
    const seq = d.model.review.seq;
    d.msg({
      type: "add/planEdits",
      filamentId: "Peddfd02",
      edits: new Map([["filament_flow_ratio", { every: "0.95" }]]),
    });
    expect(d.model.review.seq).toBe(seq + 1);
    d.msg({ type: "add/planRead", seq, plans: null, warnings: ["old"] });
    expect(d.model.review.state).toBe("loading");
    await d.settle();
    expect(d.model.review.state).toBe("ready");
    expect(d.model.planEdits.get("Peddfd02")?.size).toBe(1);
  });

  it("goes back to Find with esc when no weights were asked", async () => {
    const d = tick(start({ createSpools: false }), "polylite");
    d.key(press("right"));
    await d.settle();
    d.key(press("esc"));
    expect(d.model.page).toBe("find");
  });
});

describe("run and done", () => {
  it("writes presets, the CSV and spools, streams statuses, then reports and offers labels", async () => {
    const d = tick(start(), "punkfil");
    d.key(press("right"));
    await d.settle();
    d.key(press("a"));
    expect(d.model.page).toBe("run");
    expect(d.model.run?.state).toBe("running");
    expect(hints(d.model, d.context)).toEqual([]);
    await d.settle();

    expect(d.model.run).toMatchObject({
      state: "done",
      stage: null,
      progress: [{ preset: "written", spool: "written" }],
      spoolIds: ["1"],
      sourceLabel: "SpoolmanDB",
    });
    expect(await readdir(baseFilamentDir(home))).toContain(
      "RatRig ABS Punkfil Brute Black @Bambu Lab X1 Carbon 0.4 nozzle.json",
    );
    expect(server.spools).toHaveLength(1);
    expect(server.spools[0]?.weight_core).toBe("220");
    expect(d.of("app/runFinished")).toEqual([
      {
        type: "app/runFinished",
        summary: {
          ok: true,
          lines: ["1 filament from SpoolmanDB: 1 written, 1 new spool"],
        },
      },
    ]);
    expect(d.of("app/load")).toEqual([
      { type: "app/load", resource: "presets", force: true },
      { type: "app/load", resource: "console", force: true },
      { type: "app/load", resource: "check", force: true },
    ]);
    expect(d.of("app/toast")).toEqual([
      { type: "app/toast", text: "1 filament added · 1 new spool", tone: "ok" },
    ]);
    // The run is done with the selection, so it's cleared; the page bar says Done.
    expect(d.model.selected.size).toBe(0);
    expect(
      pageBar(d.model, d.context)
        .map((p) => [p.title, p.state])
        .at(-1),
    ).toEqual(["Done", "current"]);
    expect(hints(d.model, d.context).map((h) => h.keys)).toEqual(["l", "s", "n"]);

    d.key(press("l"));
    await d.settle();
    expect(d.of("app/openLabels")).toEqual([
      { type: "app/openLabels", request: { spoolIds: ["1"], fresh: true } },
    ]);
    d.key(press("n"));
    expect(d.model.page).toBe("find");
    expect(d.model.run).toBeNull();
  });

  it("drops replies to the finished run's review that arrive after it's done", async () => {
    const d = tick(start({ skipSpoolease: true }), "punkfil");
    d.key(press("right"));
    await d.settle();
    const { seq } = d.model.review;
    d.key(press("a"));
    await d.settle();
    expect(d.model.run?.state).toBe("done");
    d.msg({ type: "add/planRead", seq, plans: [], warnings: ["late"] });
    d.msg({ type: "add/plannedPresetFailed", seq, error: "late" });
    expect(d.model.review).toMatchObject({ state: "idle", plans: null, warnings: [], error: "" });
  });

  it("remembers the printers the run wrote for", async () => {
    const d = tick(start({ skipSpoolease: true }), "punkfil");
    d.key(press("right"));
    await d.settle();
    d.key(press("a"));
    await d.settle();
    const { loadTuiSettings } = await import("../src/tuiSettings.js");
    expect(await loadTuiSettings()).toEqual({ printers: [X1C_04] });
    expect(d.of("app/load")).toEqual([{ type: "app/load", resource: "presets", force: true }]);
  });

  it("reports failed rows with exit code 1", async () => {
    server.replies["POST /api/spools/add-edit"] = { status: 500, body: "full" };
    const d = tick(start(), "punkfil");
    d.key(press("right"));
    await d.settle();
    d.key(press("a"));
    await d.settle();
    const [finished] = d.of("app/runFinished");
    expect(finished?.summary.ok).toBe(false);
    expect(finished?.summary.exitCode).toBe(1);
    expect(finished?.summary.lines[1]).toMatch(/^RatRig ABS Punkfil Brute Black: /);
    expect(d.of("app/toast")[0]).toMatchObject({ tone: "failed" });
  });

  it("asks for exit code 2 on a setup error, keeps the selection, and enter goes back to Review", async () => {
    const d = tick(start({ skipSpoolease: true, printerPreset: "No Such Printer" }), "punkfil");
    d.key(press("right"));
    await d.settle();
    d.key(press("a"));
    await d.settle();
    expect(d.model.run?.state).toBe("failed");
    expect(d.model.run?.error).toMatch(/unknown BambuStudio printer "No Such Printer"/);
    const [finished] = d.of("app/runFinished");
    expect(finished?.summary).toMatchObject({ ok: false, exitCode: 2 });
    expect(names(d)).toEqual(["RatRig ABS Punkfil Brute Black"]);
    expect(hints(d.model, d.context).map((h) => h.keys)).toEqual(["enter", "s"]);
    d.key(press("enter"));
    expect(d.model.page).toBe("review");
    expect(d.model.run).toBeNull();
  });

  it("ignores keys while running", async () => {
    const d = tick(start({ skipSpoolease: true }), "punkfil");
    d.key(press("right"));
    await d.settle();
    d.key(press("a"), press("esc"), press("n"));
    expect(d.model.page).toBe("run");
    await d.settle();
  });
});

describe("editing a preset before the run writes it", () => {
  const RATRIG = "RatRig ABS Punkfil Brute Black";
  const RATRIG_FILE = `${RATRIG} @${X1C_04}.json`;

  it("opens the editor on the preset the run would write, and the run writes the edits", async () => {
    const d = tick(start({ skipSpoolease: true }), "punkfil");
    d.key(press("right"));
    await d.settle();
    expect(hints(d.model, d.context).map((h) => h.keys)).toContain("e");
    d.key(press("e"));
    await d.settle();
    expect(d.model.review.editing?.editor).toMatchObject({
      name: RATRIG,
      printer: X1C_04,
      mode: "planned",
    });
    expect(capturesText(d.model)).toBe(false);
    d.key(press("enter"));
    expect(capturesText(d.model)).toBe(true);
    d.key(press("u", { ctrl: true }), press("250"), press("enter"), press("esc"));
    expect(d.model.review.editing).toBeNull();
    expect(d.model.planEdits.get("P9a3bd74")).toEqual(
      new Map([["nozzle_temperature", { every: "250" }]]),
    );
    expect(d.model.review.state).toBe("loading");
    await d.settle();
    expect(d.model.review.state).toBe("ready");

    d.key(press("a"));
    await d.settle();
    const written = JSON.parse(await readFile(join(baseFilamentDir(home), RATRIG_FILE), "utf-8"));
    expect(written.nozzle_temperature).toEqual(["250"]);
  });

  it("opens again with the edits made so far, and hands keys to the editor while it's open", async () => {
    const d = tick(start({ skipSpoolease: true }), "punkfil");
    d.key(press("right"));
    await d.settle();
    d.key(press("e"));
    await d.settle();
    d.key(press("enter"), press("u", { ctrl: true }), press("250"), press("enter"));
    expect(hints(d.model, d.context).map((h) => h.label)).toEqual(
      expect.arrayContaining(["back (keeps edits)"]),
    );
    d.key(press("a"));
    expect(d.model.review.editing).toBeNull();
    await d.settle();
    d.key(press("e"));
    await d.settle();
    expect(d.model.review.editing?.editor.edits.get("nozzle_temperature")).toEqual({
      every: "250",
    });
  });

  it("says so when the run keeps every preset of the row, as there's nothing it would write", async () => {
    const dir = baseFilamentDir(home);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, RATRIG_FILE), "{}\n", "utf-8");
    const d = tick(start({ skipSpoolease: true }), "punkfil");
    d.key(press("right"));
    await d.settle();
    d.key(press("e"));
    await d.settle();
    expect(d.model.review.editing).toBeNull();
    expect(d.model.review.error).toMatch(/already there and the run keeps them/);
  });

  it("opens the editor on the variant of the printer's nozzle type in BambuStudio.conf", async () => {
    const config = join(home, ".config", "BambuStudio");
    const common = join(config, "system", "BBL", "filament", "fdm_filament_common.json");
    const preset = JSON.parse(await readFile(common, "utf-8"));
    preset.filament_extruder_variant = ["Direct Drive Standard", "Direct Drive High Flow"];
    await writeFile(common, JSON.stringify(preset), "utf-8");
    const conf = join(config, "BambuStudio.conf");
    const settings = JSON.parse(await readFile(conf, "utf-8"));
    await writeFile(
      conf,
      JSON.stringify({ ...settings, nozzle_volume_types: { [X1C_04]: "High Flow" } }),
      "utf-8",
    );
    const d = tick(start({ skipSpoolease: true }), "punkfil");
    d.key(press("right"));
    await d.settle();
    d.key(press("e"));
    await d.settle();
    expect(d.model.review.editing?.editor.active).toBe(1);
  });

  it("asks for a printer, not that the presets are there, when Settings has none", async () => {
    const d = tick(start({ skipSpoolease: true }), "punkfil");
    d.key(press("right"));
    await d.settle();
    d.context = { ...d.context, values: { ...d.context.values, printerPreset: " " } };
    d.key(press("e"));
    await d.settle();
    expect(d.model.review.editing).toBeNull();
    expect(d.model.review.error).toBe("Choose at least one printer in Settings › BambuStudio");
  });

  it("says why when BambuStudio's system presets can't build the preset", async () => {
    const base = join(home, ".config", "BambuStudio", "system", "BBL", "filament");
    const abs = join(base, "Generic ABS @base.json");
    const preset = JSON.parse(await readFile(abs, "utf-8"));
    await writeFile(abs, JSON.stringify({ ...preset, inherits: "No Such Parent" }), "utf-8");
    const d = tick(start({ skipSpoolease: true }), "punkfil");
    d.key(press("right"));
    await d.settle();
    d.key(press("e"));
    await d.settle();
    expect(d.model.review.editing).toBeNull();
    expect(d.model.review.error).toMatch(/unknown BambuStudio system preset No Such Parent/);
  });
});

describe("palette commands while Review's editor is open", () => {
  async function editing(): Promise<Driver<AddModel>> {
    const d = tick(start({ skipSpoolease: true }), "punkfil");
    d.key(press("right"));
    await d.settle();
    d.key(press("e"));
    await d.settle();
    d.key(press("enter"), press("u", { ctrl: true }), press("250"), press("enter"));
    expect(d.model.review.editing?.editor.edits.size).toBe(1);
    return d;
  }

  function run(d: Driver<AddModel>, title: RegExp): void {
    const msg = commands(d.model, d.context).find((c) => title.test(c.title))?.msg;
    if (msg?.type !== "tab") throw new Error("expected a tab message");
    d.msg(msg.msg);
  }

  const EDITED = new Map([["nozzle_temperature", { every: "250" }]]);

  it("Review the ticked keeps the editor's edits for the run", async () => {
    const d = await editing();
    run(d, /^Review the/);
    await d.settle();
    expect(d.model.review.editing).toBeNull();
    expect(d.model.planEdits.get("P9a3bd74")).toEqual(EDITED);
    expect(d.model.planChanges.get("P9a3bd74")?.length).toBe(1);
    expect(d.model.page).toBe("review");
  });

  it("Search SpoolmanDB keeps the editor's edits for the run", async () => {
    const d = await editing();
    run(d, /^Search/);
    expect(d.model.review.editing).toBeNull();
    expect(d.model.planEdits.get("P9a3bd74")).toEqual(EDITED);
    expect(d.model.page).toBe("find");
    expect(d.model.search?.focus).toBe("query");
  });

  it("refuses while the editor's nozzle range runs high to low, keeping the editor open", async () => {
    const d = await editing();
    const open = d.model.review.editing;
    if (!open) throw new Error("expected the editor");
    const backwards = new Map([
      ["nozzle_temperature_range_low", { every: "300" }],
      ["nozzle_temperature_range_high", { every: "200" }],
    ]);
    d.model = {
      ...d.model,
      review: {
        ...d.model.review,
        editing: { ...open, editor: { ...open.editor, edits: backwards } },
      },
    };
    for (const title of [/^Search/, /^Review the/]) {
      run(d, title);
      expect(d.model.review.editing?.editor.edits).toBe(backwards);
      expect(d.model.page).toBe("review");
      expect(d.model.planEdits.size).toBe(0);
      expect(d.model.notice).toMatch(/Nozzle range/);
    }
  });
});

describe("palette commands", () => {
  it("offers search, and review and untick once something is ticked", async () => {
    const d = start({ createSpools: false });
    expect(commands(d.model, d.context).map((c) => c.title)).toEqual(["Search SpoolmanDB"]);
    tick(d, "punkfil");
    expect(commands(d.model, d.context).map((c) => c.title)).toEqual([
      "Search SpoolmanDB",
      "Review the 1 ticked",
      "Untick everything",
    ]);
    const review = commands(d.model, d.context)[1]?.msg;
    if (review?.type !== "tab") throw new Error("expected a tab message");
    d.msg(review.msg);
    await d.settle();
    expect(d.model.page).toBe("review");
    expect(d.of("app/switchTab")).toEqual([{ type: "app/switchTab", tab: "add" }]);
    const clear = commands(d.model, d.context)[2]?.msg;
    if (clear?.type !== "tab") throw new Error("expected a tab message");
    d.msg(clear.msg);
    expect(d.model.selected.size).toBe(0);
    const search = commands(d.model, d.context)[0]?.msg;
    if (search?.type !== "tab") throw new Error("expected a tab message");
    d.msg(search.msg);
    expect(d.model.page).toBe("find");
    expect(d.model.search?.focus).toBe("query");
  });
});
