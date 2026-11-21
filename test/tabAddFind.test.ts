// ABOUTME: Tests for the Add tab's Find page through update(): drill-down, ticking, type-ahead, search, Other color… and import.
// ABOUTME: Keys go in as press() KeyPresses; the models and the app messages the commands send are checked.

import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { press } from "../src/tui/core/keys.js";
import { levelRows } from "../src/tui/tabs/add/catalog.js";
import { type AddModel, init, sourcesOf, ticked } from "../src/tui/tabs/add/model.js";
import { capturesText, findRows, hints, update } from "../src/tui/tabs/add/update.js";
import { catalog, ctx, Driver, PROFILES } from "./tabAddHarness.js";

const tab = { update };
const SOURCE = join(import.meta.dirname, "fixtures", "source.json");

function start(context = ctx(), query = ""): Driver<AddModel> {
  const [model, cmds] = init(context, { query });
  return new Driver(tab, model, context, cmds);
}

const top = (d: Driver<AddModel>) => d.model.stack.at(-1);
const highlighted = (d: Driver<AddModel>) => findRows(d.model, d.context)[top(d)?.cursor ?? 0];
const tickedNames = (d: Driver<AddModel>) => ticked(d.model, d.context).map((e) => e.profile.name);

describe("init", () => {
  it("opens on the brands without an import, and asks for the catalog when nobody has", async () => {
    const d = start(ctx({ resources: { catalog: { state: "idle" } } }));
    await d.settle();
    expect(top(d)).toEqual({ level: { kind: "brands" }, cursor: 0 });
    expect(d.of("app/load")).toEqual([{ type: "app/load", resource: "catalog" }]);
    d.key(press("down"));
    await d.settle();
    expect(d.of("app/load")).toHaveLength(1);
  });

  it("doesn't ask for a catalog that's loading or loaded", async () => {
    const d = start();
    await d.settle();
    expect(d.of("app/load")).toEqual([]);
  });

  it("opens in the search with the start query, its results focused", () => {
    const d = start(ctx(), "acme red");
    expect(d.model.search).toEqual({
      text: { value: "acme red", cursor: 8 },
      cursor: 0,
      focus: "list",
    });
    expect(findRows(d.model, d.context).map((r) => r.label)).toEqual(["Acme PLA Red"]);
    expect(capturesText(d.model)).toBe(false);
  });
});

describe("drill-down", () => {
  it("goes brand → material → colors with enter and back up with esc, restoring cursors", () => {
    const d = start();
    d.key(press("enter"));
    expect(top(d)).toEqual({ level: { kind: "materials", brand: "Acme" }, cursor: 0 });
    d.key(press("down"), press("enter"));
    expect(top(d)?.level).toEqual({ kind: "colors", brand: "Acme", material: "PLA" });
    expect(findRows(d.model, d.context).map((r) => r.label)).toEqual([
      "Black",
      "Blue",
      "Red",
      "Other color…",
    ]);
    d.key(press("esc"));
    expect(top(d)).toEqual({ level: { kind: "materials", brand: "Acme" }, cursor: 1 });
    d.key(press("esc"));
    expect(top(d)).toEqual({ level: { kind: "brands" }, cursor: 0 });
    d.key(press("esc"));
    expect(d.model.stack).toHaveLength(1);
  });

  it("skips the materials of a brand that has one, and esc goes back to the brands", () => {
    const d = start();
    d.key(press("down"), press("enter"));
    expect(top(d)?.level).toEqual({ kind: "colors", brand: "Sunlu", material: "PLA" });
    d.key(press("esc"));
    expect(top(d)).toEqual({ level: { kind: "brands" }, cursor: 1 });
  });

  it("jumps by first letter and moves with the list keys", () => {
    const d = start();
    d.key(press("s"));
    expect(top(d)?.cursor).toBe(1);
    d.key(press("home"));
    expect(top(d)?.cursor).toBe(0);
    d.key(press("end"));
    expect(top(d)?.cursor).toBe(1);
  });

  it("ticks with space and moves down; ctrl+a ticks the whole list, then unticks it", () => {
    const d = start();
    d.key(press("enter"), press("down"), press("enter"));
    d.key(press("space"));
    expect(top(d)?.cursor).toBe(1);
    expect(tickedNames(d)).toEqual(["Acme PLA Black"]);
    d.key(press("a", { ctrl: true }));
    expect(tickedNames(d)).toEqual(["Acme PLA Red", "Acme PLA Blue", "Acme PLA Black"]);
    d.key(press("a", { ctrl: true }));
    expect(tickedNames(d)).toEqual([]);
  });

  it("keeps the selection across levels and counts it on brands and materials", () => {
    const d = start();
    d.key(press("enter"), press("down"), press("enter"), press("space"), press("esc"));
    expect(
      levelRows(
        { kind: "materials", brand: "Acme" },
        sourcesOf(d.model, d.context),
        d.model.selected,
      )[1],
    ).toMatchObject({ ticked: 1 });
    d.key(press("esc"));
    expect(findRows(d.model, d.context)[0]).toMatchObject({ label: "Acme", ticked: 1 });
  });

  it("needs something ticked to go on with →", () => {
    const d = start();
    d.key(press("right"));
    expect(d.model.page).toBe("find");
    expect(d.model.notice).toMatch(/Tick filaments with space/);
    d.key(press("down"));
    expect(d.model.notice).toBe("");
  });

  it("goes on with just the highlighted color when enter is pressed with nothing ticked", async () => {
    const d = start();
    d.key(press("down"), press("enter"), press("enter"));
    expect(tickedNames(d)).toEqual(["Sunlu PLA White"]);
    expect(d.model.page).toBe("review");
  });

  it("asks the shell to load a failed catalog again with r", () => {
    const d = start(ctx({ resources: { catalog: { state: "failed", error: "offline" } } }));
    d.key(press("r"));
    return d.settle().then(() => {
      expect(d.of("app/load")).toEqual([{ type: "app/load", resource: "catalog", force: true }]);
      expect(hints(d.model, d.context).map((h) => h.label)).toContain("load SpoolmanDB again");
    });
  });
});

describe("search", () => {
  it("opens with /, takes every printable key into the query, and esc closes it keeping ticks", () => {
    const d = start();
    d.key(press("/"));
    expect(capturesText(d.model)).toBe(true);
    d.key(press("q"), press("?"), press("backspace"), press("backspace"));
    d.key(press("p"), press("l"), press("a"), press("space"), press("b"));
    expect(d.model.search?.text.value).toBe("pla b");
    expect(findRows(d.model, d.context).map((r) => r.label)).toEqual([
      "Acme PLA Blue",
      "Acme PLA Black",
    ]);
    d.key(press("enter"));
    expect(d.model.search?.focus).toBe("list");
    expect(capturesText(d.model)).toBe(false);
    d.key(press("space"));
    expect(d.model.search?.cursor).toBe(1);
    d.key(press("esc"));
    expect(d.model.search).toBeNull();
    expect(tickedNames(d)).toEqual(["Acme PLA Blue"]);
  });

  it("goes back to the query with / or ↑ from the first result", () => {
    const d = start(ctx(), "acme");
    d.key(press("down"), press("up"), press("up"));
    expect(d.model.search?.focus).toBe("query");
    d.key(press("down"));
    expect(d.model.search?.focus).toBe("list");
    d.key(press("/"));
    expect(d.model.search?.focus).toBe("query");
  });

  it("takes a paste as typed text", () => {
    const d = start();
    d.key(press("/"));
    d.msg({ type: "paste", text: "sunlu\n" });
    expect(d.model.search?.text.value).toBe("sunlu");
    expect(d.model.search?.focus).toBe("list");
  });

  it("ticks every match with ctrl+a", () => {
    const d = start(ctx(), "acme pla");
    d.key(press("a", { ctrl: true }));
    expect(tickedNames(d)).toHaveLength(3);
  });

  it("continues with enter on a result", () => {
    const d = start(ctx(), "sunlu");
    d.key(press("enter"));
    expect(d.model.page).toBe("review");
    expect(tickedNames(d)).toEqual(["Sunlu PLA White"]);
  });
});

describe("Other color…", () => {
  function openDialog(): Driver<AddModel> {
    const d = start();
    d.key(press("enter"), press("down"), press("enter"), press("end"), press("enter"));
    return d;
  }

  it("opens a dialog with this brand and material's colors that takes every key", () => {
    const d = openDialog();
    expect(d.model.dialog).toMatchObject({ brand: "Acme", material: "PLA", base: null });
    expect(d.model.dialog?.bases.map((p) => p.colorName)).toEqual(["Black", "Blue", "Red"]);
    expect(capturesText(d.model)).toBe(true);
    d.key(press("esc"));
    expect(d.model.dialog).toBeNull();
    expect(top(d)?.level.kind).toBe("colors");
  });

  it("adds the color to the session's catalog, ticked, with the cursor on it; it survives a catalog reload", () => {
    const d = openDialog();
    d.key(press("r"), press("down"), press("Moss"), press("down"), press("4A5D23"), press("down"));
    d.key(press("enter"));
    expect(d.model.dialog).toBeNull();
    expect(highlighted(d)).toMatchObject({ kind: "color", label: "Moss" });
    expect(tickedNames(d)).toEqual(["Acme PLA Moss"]);

    d.context = ctx({
      resources: { catalog: { state: "ready", value: catalog([...PROFILES]), at: 1 } },
    });
    d.msg({ type: "app/loaded", resource: "catalog", result: d.context.resources.catalog });
    expect(findRows(d.model, d.context).map((r) => r.label)).toContain("Moss");
    expect(tickedNames(d)).toEqual(["Acme PLA Moss"]);
  });

  it("shows the dialog's validation messages", () => {
    const d = openDialog();
    d.key(press("down"), press("down"), press("down"), press("enter"));
    expect(d.model.dialog?.error).toBe("Choose the listed color it's like");
  });
});

describe("import source", () => {
  const withImport = (source = SOURCE) => ctx({ values: { source } });

  it("lists SpoolmanDB and the import at the root, on the import, with all its profiles ticked", async () => {
    const d = start(withImport());
    expect(d.model.imported.state).toBe("loading");
    expect(top(d)).toEqual({ level: { kind: "root" }, cursor: 1 });
    await d.settle();
    expect(d.model.imported.state).toBe("ready");
    expect(findRows(d.model, d.context)).toEqual([
      { kind: "source", source: "db", label: "SpoolmanDB", count: 5, ticked: 0 },
      { kind: "source", source: "import", label: "source.json", count: 3, ticked: 3 },
    ]);
    d.key(press("enter"));
    expect(findRows(d.model, d.context).map((r) => r.label)).toEqual([
      "PETG Red",
      "Café Crème PLA",
      "Mystery Spool",
    ]);
    d.key(press("space"));
    expect(tickedNames(d)).toEqual(["Café Crème PLA", "Mystery Spool"]);
    d.key(press("esc"), press("up"), press("enter"));
    expect(top(d)?.level).toEqual({ kind: "brands" });
  });

  it("says why an import failed", async () => {
    const d = start(withImport("/nowhere/missing.json"));
    await d.settle();
    expect(d.model.imported).toMatchObject({ state: "failed" });
    expect(d.model.imported.error).toMatch(/missing\.json/);
  });

  it("follows a source changed in Settings, dropping the old import's ticks", async () => {
    const d = start(withImport());
    await d.settle();
    d.context = ctx();
    d.key(press("down"));
    await d.settle();
    expect(d.model.imported.source).toBeNull();
    expect(d.model.selected.size).toBe(0);
    expect(top(d)?.level).toEqual({ kind: "brands" });
  });
});

describe("hints", () => {
  it("lists what works on the highlighted row", () => {
    const d = start();
    expect(hints(d.model, d.context).map((h) => h.keys)).toEqual(["↑↓", "enter", "/"]);
    d.key(press("enter"), press("down"), press("enter"));
    expect(hints(d.model, d.context).map((h) => h.keys)).toEqual([
      "↑↓",
      "space",
      "enter",
      "ctrl+a",
      "/",
      "esc",
    ]);
  });

  it("never mentions a key the shell keeps (tab, q, ?)", () => {
    const d = start();
    d.key(press("enter"), press("down"), press("enter"));
    const keys = hints(d.model, d.context).map((h) => h.keys);
    for (const kept of ["tab", "q", "?"]) expect(keys).not.toContain(kept);
  });
});
