// ABOUTME: Tests the Check tab's model: the sync check's sections and items, rechecking, and giving presets an ID.
// ABOUTME: Drives update() with key presses through a mini shell; the ID writes go to real preset files in a temp HOME.

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { derivedFilamentId } from "../src/sources.js";
import type { SpoolRecord } from "../src/spoolease.js";
import { checkSync, readUserPresets } from "../src/syncCheck.js";
import type { CheckData, Ctx, Resource } from "../src/tui/core/types.js";
import { toTab } from "../src/tui/core/types.js";
import { type CheckModel, checkLogic } from "../src/tui/tabs/check/model.js";
import { checkHeadline, checkView, itemRows, sectionRows } from "../src/tui/tabs/check/report.js";
import { baseFilamentDir } from "./bambuStudioSetup.js";
import { ctxOf, Harness } from "./tabSettingsHarness.js";

const CONSOLE = { host: "10.0.0.5", securityKey: "SECRETKEY" };

function spool(overrides: Partial<SpoolRecord>): SpoolRecord {
  return {
    id: "1",
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

/** A check with two filaments no preset has, a preset without an ID, and a spool without a code. */
function data(
  presets = [{ name: "Rock", filamentId: "", printer: "X1C", path: "/p/Rock @X1C.json" }],
): CheckData {
  const csv = "PA000001,Acme PLA Red,190,230,PLA\r\nPA000002,Acme PLA Blue,190,230,PLA\r\n";
  const spools = [spool({ id: "3" }), spool({ id: "4", slicerFilament: "PA000001" })];
  return { sections: checkSync({ presets, csv, spools }), warnings: [], presets };
}

const ready = (value: CheckData): Resource<CheckData> => ({ state: "ready", value, at: 1 });

function ctxWith(check: Resource<CheckData>, values = CONSOLE): Ctx {
  return ctxOf(values, { check });
}

async function start(ctx: Ctx): Promise<Harness<CheckModel>> {
  return Harness.start("check", checkLogic, ctx);
}

/** Starts, then lets the check "arrive" as the shell would announce it. */
async function loaded(value = data(), ctx = ctxWith(ready(value))): Promise<Harness<CheckModel>> {
  const h = await start(ctx);
  await h.dispatch({ type: "app/loaded", resource: "check", result: ctx.resources.check });
  return h;
}

describe("init", () => {
  it("asks for the check when a console is set up", async () => {
    const h = await start(ctxWith({ state: "idle" }));
    expect(h.sent).toEqual([{ type: "app/load", resource: "check" }]);
    expect(checkView(h.ctx).kind).toBe("loading");
  });

  it("asks for nothing without a console, and sends you to Settings", async () => {
    for (const values of [{}, { ...CONSOLE, skipSpoolease: true }]) {
      const h = await start(ctxOf(values));
      expect(h.sent).toEqual([]);
      expect(checkView(h.ctx).kind).toBe("none");
      expect(checkLogic.hints(h.model, h.ctx)).toEqual([
        { keys: "enter", label: "set up SpoolEase in Settings", primary: true },
      ]);
      await h.press("r", "f", "enter");
      expect(h.sent).toEqual([expect.objectContaining({ type: "app/switchTab", tab: "settings" })]);
    }
  });

  it("asks again once a console is set up and the check is still idle", async () => {
    const h = await start(ctxOf());
    h.ctx = ctxWith({ state: "idle" });
    await h.dispatch({ type: "app/loaded", resource: "console", result: { state: "idle" } });
    expect(h.sent).toEqual([{ type: "app/load", resource: "check" }]);
  });
});

describe("the report", () => {
  it("has a section per check with its count, ✓ when empty, problems first", () => {
    const rows = sectionRows(data().sections);
    expect(rows.map((r) => [r.key, r.count, r.tone])).toEqual([
      ["csvOnly", 2, "problem"],
      ["unknownCode", 0, "ok"],
      ["badRows", 0, "ok"],
      ["presetsOnly", 0, "ok"],
      ["presetsNoId", 1, "note"],
      ["noCode", 1, "note"],
    ]);
  });

  it("sums up what it compared, without the key", () => {
    const ctx = ctxWith(ready(data()));
    expect(checkHeadline(data().sections, ctx)).toEqual({
      text: "2 problems · 2 notes",
      tone: "problem",
      compared: "BambuStudio default · http://10.0.0.5",
    });
    const clean = checkSync({ presets: [], csv: "", spools: [] });
    expect(checkHeadline(clean, ctx)).toMatchObject({ text: "Everything lines up", tone: "ok" });
    expect(JSON.stringify(checkHeadline(data().sections, ctx))).not.toContain("SECRETKEY");
  });

  it("starts on the first section with something in it", async () => {
    const h = await loaded();
    expect(h.model.section).toBe(0);
    const notesOnly: CheckData = {
      sections: checkSync({ presets: [], csv: "", spools: [spool({ id: "3" })] }),
      warnings: [],
      presets: [],
    };
    const h2 = await loaded(notesOnly);
    expect(sectionRows(notesOnly.sections)[h2.model.section]?.key).toBe("noCode");
  });

  it("moves between sections and keeps the cursor when the check comes back", async () => {
    const h = await loaded();
    await h.press("down", "down", "end");
    expect(h.model.section).toBe(5);
    await h.dispatch({ type: "app/loaded", resource: "check", result: h.ctx.resources.check });
    expect(h.model.section).toBe(5);
    await h.press("home");
    expect(h.model.section).toBe(0);
  });

  it("moves through a long section's items after enter, and esc goes back to the sections", async () => {
    const presets = Array.from({ length: 40 }, (_, i) => ({
      name: `Preset ${String(i).padStart(2, "0")}`,
      filamentId: `P${String(i).padStart(7, "0")}`,
      printer: "X1C",
      path: `/p/${i}.json`,
    }));
    const value = data(presets);
    const h = await loaded(value);
    const index = sectionRows(value.sections).findIndex((r) => r.key === "presetsOnly");
    await h.press("home");
    for (let i = 0; i < index; i++) await h.press("down");
    await h.press("enter");
    expect(h.model.focus).toBe("items");
    await h.press("down", "down");
    expect(h.model.item).toBe(2);
    const shown = itemRows(h.ctx, value, value.sections[index]!);
    expect(shown).toBeGreaterThan(5);
    await h.press("end");
    expect(h.model.item).toBe(39);
    await h.press("pageUp");
    expect(h.model.item).toBe(39 - shown);
    await h.press("esc");
    expect(h.model.focus).toBe("sections");
    await h.press("down");
    expect(h.model.item).toBe(0);
  });

  it("doesn't open a section with nothing in it", async () => {
    const h = await loaded();
    await h.press("down", "enter");
    expect(h.model.focus).toBe("sections");
  });

  it("checks again on r, forcing a reload", async () => {
    const h = await loaded();
    await h.press("r");
    expect(h.of("app/load")).toEqual([
      { type: "app/load", resource: "check" },
      { type: "app/load", resource: "check", force: true },
    ]);
  });

  it("shows a failed check with the last good one, and r tries again", async () => {
    const h = await start(
      ctxWith({ state: "failed", error: "SpoolEase key validation failed", previous: data() }),
    );
    expect(checkView(h.ctx)).toMatchObject({
      kind: "failed",
      error: "SpoolEase key validation failed",
    });
    expect(checkView(h.ctx).data).toBeDefined();
    await h.press("r");
    expect(h.of("app/load").at(-1)).toEqual({ type: "app/load", resource: "check", force: true });
  });

  it("hints follow focus and what can be fixed", async () => {
    const h = await loaded();
    const keys = () => checkLogic.hints(h.model, h.ctx).map((x) => `${x.keys} ${x.label}`);
    expect(keys()).toEqual([
      "↑↓ sections",
      "enter items",
      "f give 1 preset an ID",
      "r check again",
    ]);
    await h.press("enter");
    expect(keys()).toEqual([
      "↑↓ move",
      "enter sync it in Add",
      "esc sections",
      "f give 1 preset an ID",
      "r check again",
    ]);
    const empty = checkSync({ presets: [], csv: "", spools: [] });
    const clean = await loaded({ sections: empty, warnings: [], presets: [] });
    expect(checkLogic.hints(clean.model, clean.ctx).map((x) => x.keys)).toEqual(["↑↓", "r"]);
    expect(checkLogic.capturesText(h.model)).toBe(false);
  });
});

describe("giving presets a filament ID", () => {
  let home: string;
  let folder: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "bh-check-"));
    vi.stubEnv("HOME", home);
    folder = baseFilamentDir(home);
    await mkdir(folder, { recursive: true });
  });

  async function preset(name: string, printer: string, id?: string): Promise<string> {
    const path = join(folder, `${name} @${printer}.json`);
    const json = { name: `${name} @${printer}`, inherits: "", ...(id ? { filament_id: id } : {}) };
    await writeFile(path, `${JSON.stringify(json, null, 4)}\n`);
    return path;
  }

  async function realCheck(): Promise<CheckData> {
    const { presets, warnings } = await readUserPresets("default");
    return { sections: checkSync({ presets, csv: "", spools: [] }), warnings, presets };
  }

  it("reviews each file and its ID, then a writes them and reports", async () => {
    const rock1 = await preset("Rock", "X1C");
    const rock2 = await preset("Rock", "P1S");
    await preset("Red", "X1C", "PA000001");
    const h = await loaded(await realCheck());

    await h.press("f");
    expect(h.model.page).toBe("ids");
    expect(h.model.ids?.fixes.map((f) => [f.path, f.id])).toEqual([
      [rock2, derivedFilamentId("Rock")],
      [rock1, derivedFilamentId("Rock")],
    ]);
    expect(h.sent.filter((m) => m.type !== "app/load")).toEqual([]);
    expect(checkLogic.hints(h.model, h.ctx).map((x) => `${x.keys} ${x.label}`)).toEqual([
      "a write 2 files",
      "esc back",
    ]);

    const [running] = h.step({
      type: "key",
      key: { input: "a", ctrl: false, shift: false, meta: false },
    });
    expect(running.ids?.running).toBe(true);
    expect(checkLogic.hints(running, h.ctx).map((x) => x.keys)).toEqual(["esc"]);

    await h.press("a");
    expect(JSON.parse(await readFile(rock1, "utf-8")).filament_id).toBe(derivedFilamentId("Rock"));
    expect(h.model.ids?.results?.map((r) => r.ok)).toEqual([true, true]);
    expect(h.model.ids?.running).toBe(false);
    expect(h.of("app/runFinished")).toEqual([
      {
        type: "app/runFinished",
        summary: {
          ok: true,
          lines: ["1 BambuStudio preset given a filament ID: restart BambuStudio to load"],
        },
      },
    ]);
    expect(h.of("app/load").slice(1)).toEqual([
      { type: "app/load", resource: "presets", force: true },
      { type: "app/load", resource: "check", force: true },
    ]);
    expect(h.of("app/toast")).toEqual([
      { type: "app/toast", text: "1 preset given a filament ID: restart BambuStudio", tone: "ok" },
    ]);
    expect(checkLogic.hints(h.model, h.ctx).map((x) => `${x.keys} ${x.label}`)).toEqual([
      "esc back to the check",
    ]);

    await h.press("a");
    expect(h.of("app/runFinished")).toHaveLength(1);
    await h.press("esc");
    expect(h.model.page).toBe("report");
    expect(h.model.ids).toBeNull();
  });

  it("counts a preset it couldn't write as a failure", async () => {
    const rock = await preset("Rock", "X1C");
    const h = await loaded(await realCheck());
    await h.press("f");
    await writeFile(rock, "not json");
    await h.press("a");
    expect(h.model.ids?.results?.[0]).toMatchObject({ ok: false });
    expect(h.of("app/runFinished")).toEqual([
      {
        type: "app/runFinished",
        summary: {
          ok: false,
          exitCode: 1,
          lines: [
            "1 BambuStudio preset not given a filament ID",
            expect.stringMatching(/^Rock @X1C\.json: couldn't read it: /),
          ],
        },
      },
    ]);
    expect(h.of("app/toast")).toEqual([
      { type: "app/toast", text: "1 preset not given an ID", tone: "failed" },
    ]);
  });

  it("does nothing on f when every preset has an ID", async () => {
    await preset("Red", "X1C", "PA000001");
    const h = await loaded(await realCheck());
    await h.press("f");
    expect(h.model.page).toBe("report");
  });

  it("goes back with esc before writing, writing nothing", async () => {
    const rock = await preset("Rock", "X1C");
    const h = await loaded(await realCheck());
    await h.press("f", "esc");
    expect(h.model.page).toBe("report");
    expect(JSON.parse(await readFile(rock, "utf-8")).filament_id).toBeUndefined();
  });

  it("keeps results that arrive after going back", async () => {
    await preset("Rock", "X1C");
    const h = await loaded(await realCheck());
    await h.press("f");
    const [running, cmds] = h.step({
      type: "key",
      key: { input: "a", ctrl: false, shift: false, meta: false },
    });
    h.model = running;
    await h.press("esc");
    expect(h.model.page).toBe("report");
    await h.run(cmds);
    expect(h.of("app/runFinished")).toHaveLength(1);
    expect(h.model.page).toBe("report");
  });
});

describe("palette commands", () => {
  it("check again and give IDs, from anywhere", async () => {
    const h = await loaded();
    const commands = checkLogic.commands?.(h.model, h.ctx) ?? [];
    expect(commands.map((c) => [c.title, c.msg])).toEqual([
      ["Check again", toTab("check", { type: "check/recheck" })],
      ["Give presets a filament ID", toTab("check", { type: "check/fix" })],
    ]);
    await h.dispatch({ type: "check/fix" });
    expect(h.model.page).toBe("ids");
    expect(h.of("app/switchTab")).toEqual([{ type: "app/switchTab", tab: "check" }]);
    await h.dispatch({ type: "check/recheck" });
    expect(h.of("app/load").at(-1)).toEqual({ type: "app/load", resource: "check", force: true });
  });

  it("offers neither without a console", async () => {
    const h = await start(ctxOf());
    expect(checkLogic.commands?.(h.model, h.ctx)).toEqual([]);
  });
});
