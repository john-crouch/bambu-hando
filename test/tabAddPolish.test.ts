// ABOUTME: Tests for the Add tab's contract with the shell (busy, unsaved, modal, deep links) and its safety rules.
// ABOUTME: A stale review reads again, weights aren't asked for spools that won't be made, keys that fix each problem.

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { press } from "../src/tui/core/keys.js";
import type { Ctx } from "../src/tui/core/types.js";
import type { FormValues } from "../src/tui/core/values.js";
import { addTab } from "../src/tui/tabs/add/index.js";
import { type AddModel, init, ticked } from "../src/tui/tabs/add/model.js";
import {
  commands,
  currentWeightItems,
  findRows,
  hints,
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

function context(values: Partial<FormValues> = {}, now = Date.UTC(2026, 10, 21)): Ctx {
  return {
    ...ctx({
      values: {
        printerPreset: X1C_04,
        skipSpoolease: false,
        host: "127.0.0.1",
        port: String(server.port),
        securityKey: TEST_SECURITY_KEY,
        ...values,
      },
      resources: { catalog: { state: "ready", value: fixtureCatalog(), at: 0 } },
    }),
    now,
  };
}

function start(values: Partial<FormValues> = {}): Driver<AddModel> {
  const c = context(values);
  const [model, cmds] = init(c, { query: "" });
  return new Driver(tab, model, c, cmds);
}

function tick(d: Driver<AddModel>, ...searches: string[]): Driver<AddModel> {
  for (const search of searches)
    d.key(press("/"), press(search), press("a", { ctrl: true }), press("esc"));
  return d;
}

const POLYLITE = "Peddfd02";
const PUNKFIL = "P9a3bd74";
const top = (d: Driver<AddModel>) => d.model.stack.at(-1);
const keysOf = (d: Driver<AddModel>) => hints(d.model, d.context).map((h) => h.keys);

describe("the shell's contract", () => {
  it("is busy while a run writes, and not before or after", async () => {
    const d = tick(start({ skipSpoolease: true }), "punkfil");
    d.key(press("right"));
    await d.settle();
    expect(addTab.busy?.(d.model)).toBeNull();
    d.key(press("a"));
    expect(addTab.busy?.(d.model)).toBe("Adding 1 filament");
    await d.settle();
    expect(addTab.busy?.(d.model)).toBeNull();
  });

  it("counts plan edits as unsaved, including those in the open editor", async () => {
    const d = tick(start({ skipSpoolease: true }), "punkfil");
    expect(addTab.unsaved?.(d.model)).toBe(0);
    d.key(press("right"));
    await d.settle();
    d.msg({
      type: "add/planEdits",
      filamentId: PUNKFIL,
      edits: new Map([["filament_flow_ratio", { every: "0.9" }]]),
    });
    await d.settle();
    expect(addTab.unsaved?.(d.model)).toBe(1);
    d.key(press("e"));
    await d.settle();
    d.key(press("enter"), press("u", { ctrl: true }), press("250"), press("enter"));
    expect(addTab.unsaved?.(d.model)).toBe(2);
  });

  it("is modal while the Other color dialog is open; tab moves between its fields", () => {
    const d = start({ skipSpoolease: true });
    d.key(press("r"), press("enter"));
    expect(addTab.modal?.(d.model)).toBe(false);
    d.key(press("o"), press("enter"));
    expect(d.model.dialog).not.toBeNull();
    expect(addTab.modal?.(d.model)).toBe(true);
    d.key(press("tab"));
    expect(d.model.dialog?.field).toBe("name");
    d.key(press("tab", { shift: true }));
    expect(d.model.dialog?.field).toBe("base");
    d.key(press("q"));
    expect(d.model.dialog).not.toBeNull();
  });
});

describe("palette", () => {
  it("shows the keys that do the same, and has no reload of its own", () => {
    const d = tick(start({ createSpools: false }), "punkfil");
    expect(commands(d.model, d.context).map((c) => [c.title, c.keys])).toEqual([
      ["Search SpoolmanDB", "/"],
      ["Review the 1 ticked", "→"],
      ["Untick everything", undefined],
    ]);
  });
});

describe("deep links", () => {
  it("opens on a catalog filament, highlighted and ticked", () => {
    const d = start({ createSpools: false });
    d.msg({ type: "app/switchTab", tab: "add", focus: PUNKFIL });
    expect(d.model.page).toBe("find");
    expect(top(d)?.level).toEqual({ kind: "colors", brand: "RatRig", material: "ABS" });
    const row = findRows(d.model, d.context)[top(d)?.cursor ?? -1];
    expect(row?.kind === "color" && row.profile.filamentId).toBe(PUNKFIL);
    expect(ticked(d.model, d.context).map((e) => e.profile.filamentId)).toEqual([PUNKFIL]);
  });

  it("waits for the catalog when it isn't loaded yet", () => {
    const loading = { ...context(), resources: { ...context().resources } };
    loading.resources.catalog = { state: "loading" };
    const [model] = init(loading, { query: "" });
    const d = new Driver(tab, model, loading);
    d.msg({ type: "app/switchTab", tab: "add", focus: PUNKFIL });
    expect(ticked(d.model, d.context)).toEqual([]);
    d.context = context();
    d.msg({ type: "app/loaded", resource: "catalog", result: d.context.resources.catalog });
    expect(ticked(d.model, d.context).map((e) => e.profile.filamentId)).toEqual([PUNKFIL]);
  });

  it("sends the key that fixes a setting to the very row in Settings", async () => {
    const d = tick(start({ skipSpoolease: true, printerPreset: "" }), "punkfil");
    d.key(press("right"));
    await d.settle();
    d.key(press("a"));
    expect(keysOf(d)).toContain("s");
    d.key(press("s"));
    expect(d.of("app/switchTab")).toEqual([
      { type: "app/switchTab", tab: "settings", focus: "bambu.printers" },
    ]);
  });

  it("sends a refused key to the key's row", async () => {
    const d = tick(start({ securityKey: "WRONG" }), "polylite");
    d.key(press("right"));
    await d.settle();
    d.key(press("s"));
    expect(d.of("app/switchTab")).toEqual([
      { type: "app/switchTab", tab: "settings", focus: "spoolease.key" },
    ]);
  });
});

describe("search", () => {
  it("stays in the query when a paste ending in enter leaves no matches", () => {
    const d = start();
    d.key(press("/"), press("punkfil"));
    d.msg({ type: "paste", text: "zzz\r" });
    expect(d.model.search).toMatchObject({ focus: "query", text: { value: "punkfilzzz" } });
  });

  it("goes to the results when a paste ending in enter has matches", () => {
    const d = start();
    d.key(press("/"));
    d.msg({ type: "paste", text: "punkfil\r" });
    expect(d.model.search?.focus).toBe("list");
  });
});

describe("type-ahead", () => {
  it("jumps on several letters typed together, and starts over after a pause", () => {
    const d = start();
    const brand = () => findRows(d.model, d.context)[top(d)?.cursor ?? 0]?.label;
    d.key(press("3"), press("D"), press("X"));
    expect(brand()).toBe("3DXTECH");
    d.context = { ...d.context, now: d.context.now + 1000 };
    d.key(press("p"));
    expect(brand()).toBe("Polymaker");
  });
});

describe("weights", () => {
  it("preselects the source's weight the first time", async () => {
    const d = tick(start(), "polylite");
    d.key(press("right"));
    await d.settle();
    expect(currentWeightItems(d.model)[d.model.weights.cursor]?.label).toBe(
      "As listed in SpoolmanDB",
    );
  });

  it("aren't asked when every ticked filament has a spool already, as no spool is made", async () => {
    server.spools.push({ id: "1", slicer_filament: POLYLITE });
    const d = tick(start(), "polylite");
    d.key(press("right"));
    await d.settle();
    expect(d.model.page).toBe("review");
    expect(d.model.review.plans?.[0]?.spool).toBe("exists");
  });

  it("remembers the choice for the next run of the session", async () => {
    const d = tick(start(), "polylite");
    d.key(press("right"));
    await d.settle();
    d.key(press("home"), press("enter"));
    await d.settle();
    d.key(press("a"));
    await d.settle();
    expect(d.model.run?.state).toBe("done");
    d.key(press("n"));
    server.spools.length = 0;
    tick(d, "polylite");
    d.key(press("right"));
    await d.settle();
    expect(d.model.page).toBe("weights");
    expect(d.model.weights.cursor).toBe(0);
  });
});

describe("weights across sessions", () => {
  it("preselects the weight chosen in an earlier session for the brand", async () => {
    const first = tick(start(), "polylite");
    first.key(press("right"));
    await first.settle();
    first.key(press("home"), press("enter"));
    await first.settle();
    const { loadTuiSettings } = await import("../src/tuiSettings.js");
    expect((await loadTuiSettings()).weights).toEqual({
      polymaker: { kind: "grams", grams: 137 },
    });

    const next = tick(start(), "polylite");
    next.key(press("right"));
    await next.settle();
    expect(next.model.page).toBe("weights");
    expect(next.model.weights.cursor).toBe(0);
  });

  it("says so when the choice can't be remembered, and goes on", async () => {
    // bambu-hando's config folder is a file: nothing can be saved there.
    await writeFile(join(home, ".config", "bambu-hando"), "not a folder");
    const d = tick(start(), "polylite");
    d.key(press("right"));
    await d.settle();
    d.key(press("enter"));
    await d.settle();
    expect(d.model.page).toBe("review");
    expect(d.of("app/toast")[0]).toMatchObject({ tone: "warning" });
    expect(d.of("app/toast")[0]?.text).toMatch(/^Couldn't remember the empty spool weight/);
  });
});

describe("review", () => {
  async function kept(d: Driver<AddModel>): Promise<void> {
    const dir = baseFilamentDir(home);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `RatRig ABS Punkfil Brute Black @${X1C_04}.json`), "{}\n");
    tick(d, "punkfil");
    d.key(press("right"));
    await d.settle();
  }

  it("names the editor's changes in the plan's note", async () => {
    const d = tick(start({ skipSpoolease: true }), "punkfil");
    d.key(press("right"));
    await d.settle();
    d.key(press("e"));
    await d.settle();
    d.key(press("enter"), press("u", { ctrl: true }), press("250"), press("enter"), press("esc"));
    await d.settle();
    const { planNotes } = await import("../src/tui/tabs/add/plan.js");
    const notes = planNotes(
      d.model.review.profiles,
      d.model.review.plans ?? [],
      false,
      d.model.planEdits,
      d.model.planChanges,
    );
    expect(notes[0]?.text).toBe(
      `✎ ${PUNKFIL}: Nozzle 245°C → 250°C goes into the 1 preset the run writes`,
    );
  });

  it("says there's nothing to apply when the run would change nothing", async () => {
    const d = start({ skipSpoolease: true });
    await kept(d);
    expect(keysOf(d)).not.toContain("a");
    d.key(press("a"));
    expect(d.model.page).toBe("review");
    expect(d.model.notice).toBe("Nothing to apply: everything is there already");
  });

  it("reads the plan again when the settings changed while away", async () => {
    const d = tick(start({ skipSpoolease: true }), "punkfil");
    d.key(press("right"));
    await d.settle();
    const seq = d.model.review.seq;
    d.context = { ...d.context, values: { ...d.context.values, overwritePresets: true } };
    d.msg({ type: "app/switchTab", tab: "add" });
    expect(d.model.review.seq).toBe(seq + 1);
    expect(d.model.review.state).toBe("loading");
    await d.settle();
    d.msg({ type: "app/switchTab", tab: "add" });
    expect(d.model.review.seq).toBe(seq + 1);
  });

  it("won't apply a plan read with other settings: it reads again first", async () => {
    const d = tick(start({ skipSpoolease: true }), "punkfil");
    d.key(press("right"));
    await d.settle();
    d.context = { ...d.context, values: { ...d.context.values, overwritePresets: true } };
    d.key(press("a"));
    expect(d.model.page).toBe("review");
    expect(d.model.run).toBeNull();
    expect(d.model.notice).toMatch(/Settings changed/);
    await d.settle();
    d.key(press("a"));
    expect(d.model.page).toBe("run");
    await d.settle();
  });
});

describe("done", () => {
  it("offers the new spools in Spools", async () => {
    const d = tick(start(), "punkfil");
    d.key(press("right"));
    await d.settle();
    d.key(press("a"));
    await d.settle();
    expect(keysOf(d)).toEqual(["l", "s", "n"]);
    d.key(press("s"));
    expect(d.of("app/switchTab")).toEqual([{ type: "app/switchTab", tab: "spools", focus: "1" }]);
  });
});
