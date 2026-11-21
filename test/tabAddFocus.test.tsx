// ABOUTME: Tests for Add's deep links (app/switchTab focus): a filament ID, or "id:<id>|name:<name>" as Check sends it.
// ABOUTME: Found → drilled to and ticked; not found → a search by its name, else an empty state pointing at Settings › Import.

import { stripVTControlCharacters } from "node:util";
import { ThemeProvider } from "@inkjs/ui";
import { renderToString } from "ink";
import { describe, expect, it } from "vitest";

import { press } from "../src/tui/core/keys.js";
import type { AppMsg, Ctx } from "../src/tui/core/types.js";
import { addTab } from "../src/tui/tabs/add/index.js";
import type { AddModel } from "../src/tui/tabs/add/model.js";
import { parseFocus } from "../src/tui/tabs/add/update.js";
import { textWidth, theme } from "../src/tui/ui/index.js";
import { ctx } from "./tabAddHarness.js";

function open(focus: string, c: Ctx = ctx()): [AddModel, AppMsg[]] {
  const [model] = addTab.init(c, { query: "" });
  const [next] = addTab.update(model, { type: "app/switchTab", tab: "add", focus }, c);
  return [next, []];
}

function screen(model: AddModel, c: Ctx = ctx()): string {
  const out = renderToString(
    <ThemeProvider theme={theme}>
      <addTab.View model={model} ctx={c} />
    </ThemeProvider>,
    { columns: c.columns },
  );
  return stripVTControlCharacters(out);
}

/** The messages a key's commands send (they're all plain sends here). */
async function sent(model: AddModel, key: string, c: Ctx = ctx()): Promise<AppMsg[]> {
  const [, cmds] = addTab.update(model, { type: "key", key: press(key) }, c);
  const out: AppMsg[] = [];
  for (const cmd of cmds) await cmd((msg) => out.push(msg));
  return out;
}

describe("parseFocus", () => {
  it("reads a bare ID, an ID with a name, and a name holding a |", () => {
    expect(parseFocus("PACMRED0")).toEqual({ id: "PACMRED0", name: "" });
    expect(parseFocus("id:PACMRED0")).toEqual({ id: "PACMRED0", name: "" });
    expect(parseFocus("id:P4D5E6F7|name:Acme PLA Red")).toEqual({
      id: "P4D5E6F7",
      name: "Acme PLA Red",
    });
    expect(parseFocus("id:P1|name:A|B")).toEqual({ id: "P1", name: "A|B" });
  });
});

describe("a deep link", () => {
  it("drills to a listed filament and ticks it, with or without its name", () => {
    for (const focus of ["PACMRED0", "id:PACMRED0|name:Something else"]) {
      const [model] = open(focus);
      expect(model.selected.has("db:PACMRED0")).toBe(true);
      expect(model.stack.at(-1)?.level).toEqual({ kind: "colors", brand: "Acme", material: "PLA" });
    }
  });

  it("searches by name when the ID isn't listed, saying so", () => {
    const [model] = open("id:P4D5E6F7|name:Acme PLA");
    expect(model.search?.text.value).toBe("Acme PLA");
    expect(model.search?.focus).toBe("list");
    expect(model.notice).toBe("P4D5E6F7 isn't in SpoolmanDB by its ID: these match its name");
    expect(screen(model)).toContain("Acme PLA Red");
  });

  it("shows where to add a filament nothing matches, and enter goes there", async () => {
    const [model] = open("id:P4D5E6F7|name:Nope Filament Teal");
    expect(model.search).toBeNull();
    const text = screen(model);
    expect(text).toContain("Nope Filament Teal isn't in SpoolmanDB");
    expect(text).toContain("Settings › Import");
    expect(addTab.hints(model, ctx()).map((h) => `${h.keys} ${h.label}`)).toEqual(
      expect.arrayContaining(["enter open Settings › Import", "/ search", "esc back"]),
    );
    expect(await sent(model, "enter")).toEqual([
      { type: "app/switchTab", tab: "settings", focus: "import.source" },
    ]);
  });

  it("names the ID when there's no name, and esc goes back to the brands", () => {
    for (const focus of ["P4D5E6F7", "id:P4D5E6F7"]) {
      const [model] = open(focus);
      expect(screen(model)).toContain("P4D5E6F7 isn't in SpoolmanDB");
      const [back] = addTab.update(model, { type: "key", key: press("esc") }, ctx());
      expect(back.stack.at(-1)?.level.kind).toBe("brands");
    }
  });

  it("/ on the empty state searches with the name typed", () => {
    const [model] = open("id:P4D5E6F7|name:Nope Teal");
    const [searching] = addTab.update(model, { type: "key", key: press("/") }, ctx());
    expect(searching.search?.text.value).toBe("Nope Teal");
    expect(searching.search?.focus).toBe("query");
  });

  it("waits for the catalog, then opens the link", () => {
    const loading = ctx({ resources: { catalog: { state: "loading" } } });
    const [model] = addTab.init(loading, { query: "" });
    const [waiting] = addTab.update(
      model,
      { type: "app/switchTab", tab: "add", focus: "id:P4D5E6F7|name:Acme PLA" },
      loading,
    );
    expect(waiting.search).toBeNull();
    const ready = ctx();
    const [opened] = addTab.update(
      waiting,
      { type: "app/loaded", resource: "catalog", result: ready.resources.catalog },
      ready,
    );
    expect(opened.search?.text.value).toBe("Acme PLA");
  });
});

describe("the not-listed state", () => {
  it.each([
    [60, 20],
    [120, 36],
  ])("fits %ix%i without cutting its words", (columns, rows) => {
    const c = { ...ctx(), columns, rows, bodyColumns: columns, bodyRows: rows - 2 };
    const [model] = open("id:P4D5E6F7|name:Nope Filament Teal", c);
    const lines = screen(model, c).split("\n");
    for (const line of lines) expect(textWidth(line)).toBeLessThanOrEqual(columns);
    const words = lines
      .map((line) => line.replace(/[│╭╮╰╯─]/g, " "))
      .join(" ")
      .replace(/\s+/g, " ");
    expect(words).toContain("Nope Filament Teal isn't in SpoolmanDB");
    expect(words).toContain(
      "Add it from a file or URL in Settings › Import, or search for a close one.",
    );
    expect(words).not.toContain("…");
  });
});
