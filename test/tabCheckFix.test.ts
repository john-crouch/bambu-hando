// ABOUTME: Tests the Check tab's items as things to act on: the highlighted item, enter jumping to its fix, deep links.
// ABOUTME: Also the write guard (busy, one write at a time), the headline's tone and the check without a console.

import { describe, expect, it } from "vitest";

import type { SpoolRecord } from "../src/spoolease.js";
import { checkSync, type UserPreset } from "../src/syncCheck.js";
import type { CheckData, Ctx, PresetsData, Resource } from "../src/tui/core/types.js";
import { type CheckModel, checkLogic } from "../src/tui/tabs/check/model.js";
import { checkHeadline, checkView, itemViews, sectionRows } from "../src/tui/tabs/check/report.js";
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

const PRESETS: UserPreset[] = [
  { name: "Rock", filamentId: "", printer: "Bambu Lab X1 Carbon 0.4 nozzle", path: "/p/r4.json" },
  { name: "Rock", filamentId: "", printer: "Bambu Lab X1 Carbon 0.6 nozzle", path: "/p/r6.json" },
  {
    name: "Stone",
    filamentId: "PB000001",
    printer: "Bambu Lab X1 Carbon 0.4 nozzle",
    path: "/p/s.json",
  },
  { name: "Acme PLA Red", filamentId: "PA000001", printer: "X1C", path: "/p/red.json" },
];

/** A filament no preset has, a spool of an unknown filament, one without a code, presets without an ID. */
function data(presets = PRESETS): CheckData {
  const csv = "PA000001,Acme PLA Red,190,230,PLA\r\nPA000002,Acme PLA Blue,190,230,PLA\r\n";
  const spools = [
    spool({ id: "3" }),
    spool({ id: "4", slicerFilament: "PA000001" }),
    spool({ id: "7", slicerFilament: "PZZZZZZ", colorName: "Green" }),
  ];
  return { sections: checkSync({ presets, csv, spools }), warnings: [], presets };
}

const ready = <T>(value: T): Resource<T> => ({ state: "ready", value, at: 1 });

async function loaded(value = data(), ctx: Ctx = ctxOf(CONSOLE, { check: ready(value) })) {
  const h = await Harness.start("check", checkLogic, ctx);
  await h.dispatch({ type: "app/loaded", resource: "check", result: ctx.resources.check });
  return h;
}

function sectionIndex(value: CheckData, key: string): number {
  return sectionRows(value.sections).findIndex((r) => r.key === key);
}

/** Puts the cursor on a section and focuses its items. */
async function openSection(h: Harness<CheckModel>, value: CheckData, key: string) {
  await h.press("home");
  for (let i = 0; i < sectionIndex(value, key); i++) await h.press("down");
  await h.press("enter");
  expect(h.model.focus).toBe("items");
}

const hintText = (h: Harness<CheckModel>) =>
  checkLogic.hints(h.model, h.ctx).map((x) => `${x.keys} ${x.label}`);

describe("the headline", () => {
  it("is ✓ with no problems, even with notes, and joins the counts with ·", () => {
    const ctx = ctxOf(CONSOLE);
    const notesOnly = checkSync({ presets: [], csv: "", spools: [spool({ id: "3" })] });
    expect(checkHeadline(notesOnly, ctx)).toMatchObject({
      text: "No problems · 1 note",
      tone: "ok",
    });
    expect(checkHeadline(data().sections, ctx)).toMatchObject({
      text: "2 problems · 3 notes",
      tone: "problem",
    });
    const clean = checkSync({ presets: [], csv: "", spools: [] });
    expect(checkHeadline(clean, ctx)).toMatchObject({ text: "Everything lines up", tone: "ok" });
  });
});

describe("items", () => {
  it("are rows with a cursor, the name kept apart from codes and short printers", () => {
    const value = data();
    const views = (key: string) => {
      const section = value.sections.find((s) => s.key === key);
      return section ? itemViews(section, value) : [];
    };
    expect(views("presetsNoId")).toEqual([
      expect.objectContaining({
        name: "Rock",
        printers: "X1C 0.4, 0.6",
        target: { kind: "ids", paths: ["/p/r4.json", "/p/r6.json"] },
      }),
    ]);
    expect(views("presetsOnly")).toEqual([
      expect.objectContaining({
        name: "Stone",
        code: "PB000001",
        printers: "X1C 0.4",
        target: { kind: "add", id: "PB000001", name: "Stone" },
      }),
    ]);
    expect(views("csvOnly")).toEqual([
      expect.objectContaining({
        name: "Acme PLA Blue",
        code: "PA000002",
        target: { kind: "add", id: "PA000002", name: "Acme PLA Blue" },
      }),
    ]);
    expect(views("unknownCode")).toEqual([
      expect.objectContaining({
        spool: "7",
        name: "Acme PLA Green",
        code: "PZZZZZZ",
        target: { kind: "add", id: "PZZZZZZ", name: "Acme PLA Green" },
      }),
    ]);
    expect(views("noCode")).toEqual([
      expect.objectContaining({ spool: "3", target: { kind: "spools", id: "3" } }),
    ]);
  });

  it("move with ↑↓ and keep the cursor in the section", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      name: `Preset ${String(i).padStart(2, "0")}`,
      filamentId: `P${String(i).padStart(7, "0")}`,
      printer: "X1C",
      path: `/p/${i}.json`,
    }));
    const value = data(many);
    const h = await loaded(value);
    await openSection(h, value, "presetsOnly");
    expect(h.model.item).toBe(0);
    await h.press("down", "down");
    expect(h.model.item).toBe(2);
    await h.press("end");
    expect(h.model.item).toBe(29);
    await h.press("esc");
    expect(h.model.focus).toBe("sections");
    await h.press("down");
    expect(h.model.item).toBe(0);
  });

  it("enter on a filament SpoolEase has but no preset has finds it in Add, by ID and name", async () => {
    const value = data();
    const h = await loaded(value);
    await openSection(h, value, "csvOnly");
    expect(hintText(h)).toEqual([
      "↑↓ move",
      "enter find it in Add",
      "esc sections",
      "f give 1 preset an ID",
      "r check again",
    ]);
    await h.press("enter");
    expect(h.of("app/switchTab")).toEqual([
      { type: "app/switchTab", tab: "add", focus: "id:PA000002|name:Acme PLA Blue" },
    ]);
  });

  it("enter on a preset SpoolEase lacks finds its filament in Add", async () => {
    const value = data();
    const h = await loaded(value);
    await openSection(h, value, "presetsOnly");
    expect(hintText(h)[1]).toBe("enter find it in Add");
    await h.press("enter");
    expect(h.of("app/switchTab")).toEqual([
      { type: "app/switchTab", tab: "add", focus: "id:PB000001|name:Stone" },
    ]);
  });

  it("enter on a spool of an unknown filament finds that filament in Add", async () => {
    const value = data();
    const h = await loaded(value);
    await openSection(h, value, "unknownCode");
    expect(hintText(h)[1]).toBe("enter find it in Add");
    await h.press("enter");
    const [link] = h.of("app/switchTab") as { focus?: string }[];
    expect(link?.focus).toMatch(/^id:PZZZZZZ\|name:\S/);
  });

  it("enter on a preset without an ID reviews giving just that preset one", async () => {
    const value = data();
    const h = await loaded(value);
    await openSection(h, value, "presetsNoId");
    // enter is the same fix for this preset, so f isn't offered beside it.
    expect(hintText(h)).toEqual(["↑↓ move", "enter give it an ID", "esc sections", "r check again"]);
    await h.press("enter");
    expect(h.model.page).toBe("ids");
    expect(h.model.ids?.fixes.map((f) => f.path)).toEqual(["/p/r4.json", "/p/r6.json"]);
  });

  it("enter on a spool without a code shows it in Spools", async () => {
    const value = data();
    const h = await loaded(value);
    await openSection(h, value, "noCode");
    expect(hintText(h)[1]).toBe("enter show it in Spools");
    await h.press("enter");
    expect(h.of("app/switchTab")).toEqual([{ type: "app/switchTab", tab: "spools", focus: "3" }]);
  });

  it("offers no enter on a row SpoolEase misreads: the fix is on the console", async () => {
    const value: CheckData = {
      sections: checkSync({ presets: [], csv: "PA1,a,b\r\n", spools: [] }),
      warnings: [],
      presets: [],
    };
    const h = await loaded(value);
    await openSection(h, value, "badRows");
    expect(hintText(h).some((x) => x.startsWith("enter"))).toBe(false);
    await h.press("enter");
    expect(h.of("app/switchTab")).toEqual([]);
  });
});

describe("counting presets, not files", () => {
  it("says 1 preset when it has a file per printer, and the review says the files", async () => {
    const h = await loaded();
    expect(hintText(h)).toContain("f give 1 preset an ID");
    await h.press("f");
    expect(hintText(h)).toEqual(["a write 2 files", "esc back"]);
  });
});

describe("deep links", () => {
  it("opens on the section a switchTab names, its items focused", async () => {
    const value = data();
    const h = await loaded(value);
    await h.dispatch({ type: "app/switchTab", tab: "check", focus: "noCode" });
    expect(h.model.section).toBe(sectionIndex(value, "noCode"));
    expect(h.model.focus).toBe("items");
    expect(h.model.item).toBe(0);
  });

  it("keeps the review on screen while it writes, and ignores an unknown focus", async () => {
    const value = data();
    const h = await loaded(value);
    await h.dispatch({ type: "app/switchTab", tab: "check", focus: "nonsense" });
    expect(h.model.section).toBe(0);
    await h.press("f");
    await h.dispatch({ type: "app/switchTab", tab: "check", focus: "noCode" });
    expect(h.model.page).toBe("report");
    expect(h.model.section).toBe(sectionIndex(value, "noCode"));
    await h.press("f");
    [h.model] = h.step({
      type: "key",
      key: { input: "a", ctrl: false, shift: false, meta: false },
    });
    await h.dispatch({ type: "app/switchTab", tab: "check", focus: "csvOnly" });
    expect(h.model.page).toBe("ids");
  });

  it("sends you to the console's host in Settings without a console", async () => {
    const h = await Harness.start("check", checkLogic, ctxOf());
    await h.press("enter");
    expect(h.of("app/switchTab")).toEqual([
      { type: "app/switchTab", tab: "settings", focus: "spoolease.host" },
    ]);
    const skipped = await Harness.start(
      "check",
      checkLogic,
      ctxOf({ ...CONSOLE, skipSpoolease: true }),
    );
    await skipped.press("enter");
    expect(skipped.of("app/switchTab")).toEqual([
      { type: "app/switchTab", tab: "settings", focus: "spoolease.skip" },
    ]);
  });
});

describe("one write at a time", () => {
  it("is busy while writing IDs, and f goes back to the running review instead of a second", async () => {
    const h = await loaded();
    await h.press("f");
    const [running] = h.step({
      type: "key",
      key: { input: "a", ctrl: false, shift: false, meta: false },
    });
    expect(checkLogic.busy?.(running)).toBe("Writing filament IDs into BambuStudio presets");
    h.model = running;
    await h.press("esc");
    expect(h.model.page).toBe("report");
    const ids = h.model.ids;
    await h.press("f");
    expect(h.model.page).toBe("ids");
    expect(h.model.ids).toBe(ids);
    await h.dispatch({ type: "check/fix" });
    expect(h.model.ids).toBe(ids);
    expect(checkLogic.busy?.({ ...h.model, ids: null })).toBeNull();
  });
});

describe("a console that can't be reached", () => {
  const failed: Resource<CheckData> = {
    state: "failed",
    error: "SpoolEase unreachable at http://10.0.0.5: fetch failed",
  };
  const presets: Resource<PresetsData> = ready({ presets: PRESETS, warnings: [] });

  it("still checks BambuStudio's presets, and marks the console's sections not checked", async () => {
    const ctx = ctxOf(CONSOLE, { check: failed, presets });
    const view = checkView(ctx);
    expect(view.kind).toBe("failed");
    expect(view.offline).toBe(true);
    const rows = sectionRows(view.data?.sections ?? [], view.offline);
    expect(rows.map((r) => [r.key, r.tone])).toEqual([
      ["csvOnly", "offline"],
      ["unknownCode", "offline"],
      ["badRows", "offline"],
      ["presetsOnly", "offline"],
      ["presetsNoId", "note"],
      ["noCode", "offline"],
    ]);
    const h = await loaded(view.data, ctx);
    expect(h.model.section).toBe(sectionIndex(view.data as CheckData, "presetsNoId"));
    expect(hintText(h)).toContain("f give 1 preset an ID");
  });

  it("asks for the presets it needs, and enter on a console section opens Settings", async () => {
    const ctx = ctxOf(CONSOLE, { check: failed });
    const h = await Harness.start("check", checkLogic, ctx);
    await h.dispatch({ type: "app/loaded", resource: "check", result: failed });
    expect(h.of("app/load")).toContainEqual({ type: "app/load", resource: "presets" });
    h.ctx = ctxOf(CONSOLE, { check: failed, presets });
    await h.dispatch({ type: "app/loaded", resource: "presets", result: presets });
    await h.press("home");
    expect(hintText(h)).toContain("enter open Settings");
    await h.press("enter");
    expect(h.of("app/switchTab")).toEqual([
      { type: "app/switchTab", tab: "settings", focus: "spoolease.host" },
    ]);
  });

  it("opens Settings on the row the console's problem points at", async () => {
    const cases: [string, string][] = [
      ["SpoolEase key validation failed", "spoolease.key"],
      ["SpoolEase unreachable at http://10.0.0.5: fetch failed: connect ECONNREFUSED 10.0.0.5:81", "spoolease.port"],
      ["SpoolEase unreachable at http://nope.local: fetch failed: getaddrinfo ENOTFOUND nope.local", "spoolease.host"],
      ["SpoolEase unreachable at http://10.0.0.5: This operation was aborted", "spoolease.host"],
    ];
    for (const [error, focus] of cases) {
      const check: Resource<CheckData> = { state: "failed", error };
      const ctx = ctxOf(CONSOLE, { check, presets });
      const h = await loaded(checkView(ctx).data, ctx);
      await h.press("home", "enter");
      expect(h.of("app/switchTab")).toEqual([{ type: "app/switchTab", tab: "settings", focus }]);
    }
  });
});

describe("narrow terminals", () => {
  it("makes esc a primary hint while the items hide the sections", async () => {
    const value = data();
    const narrow = { ...ctxOf(CONSOLE, { check: ready(value) }), bodyColumns: 60, columns: 60 };
    const h = await loaded(value, narrow);
    await openSection(h, value, "csvOnly");
    const esc = checkLogic.hints(h.model, h.ctx).find((x) => x.keys === "esc");
    expect(esc).toEqual({ keys: "esc", label: "sections", primary: true });
  });
});
