// ABOUTME: Unit tests of the shell's own overlays: the palette's fuzzy filter and keys, help's layout and scrolling, confirm.
// ABOUTME: Pure functions and updates only; the shell render tests cover how they look.

import { describe, expect, it } from "vitest";

import { CONFIRM, confirmWidth } from "../src/tui/app/confirm.js";
import {
  GLOBAL_HELP,
  HELP,
  type HelpRequest,
  helpLines,
  helpNote,
  helpSize,
  wrap,
} from "../src/tui/app/help.js";
import type { PaletteItem, ShellMsg } from "../src/tui/app/messages.js";
import {
  fuzzyMatch,
  PALETTE,
  type PaletteModel,
  paletteInput,
  paletteLayout,
  paletteRows,
  rowSegments,
  SHELL_GROUPS,
} from "../src/tui/app/palette.js";
import { press } from "../src/tui/core/keys.js";
import type { Cmd } from "../src/tui/core/program.js";
import type { Ctx } from "../src/tui/core/types.js";
import { values } from "./shellFixtures.js";

const ctx = (columns = 80, rows = 24): Ctx => ({
  values: values(),
  resources: {
    console: { state: "idle" },
    presets: { state: "idle" },
    catalog: { state: "idle" },
    check: { state: "idle" },
  },
  columns,
  rows,
  bodyColumns: columns,
  bodyRows: rows - 2,
  now: 0,
});

function sent(cmds: Cmd<ShellMsg>[]): ShellMsg[] {
  const out: ShellMsg[] = [];
  for (const cmd of cmds) void cmd((m) => out.push(m));
  return out;
}

const item = (title: string, extra: Partial<PaletteItem> = {}): PaletteItem => ({
  title,
  msg: { type: "app/quit" },
  ...extra,
});

describe("fuzzyMatch", () => {
  it("matches characters in order, ignoring case and spaces", () => {
    expect(fuzzyMatch("gtp", "Go to Presets")?.hits).toEqual([0, 3, 6]);
    expect(fuzzyMatch("presets thing", "presets thing")?.hits).toHaveLength(12);
    expect(fuzzyMatch("xyz", "Go to Presets")).toBeNull();
    expect(fuzzyMatch("", "anything")).toEqual({ score: 0, hits: [] });
  });

  it("ranks word starts and runs above scattered letters", () => {
    const model: PaletteModel = {
      items: [item("Reload SpoolmanDB catalog"), item("Print labels"), item("Go to Spools")],
      query: "spo",
      cursor: 0,
    };
    expect(paletteRows(model).map((r) => r.item.title)).toEqual([
      "Go to Spools",
      "Reload SpoolmanDB catalog",
    ]);
  });

  it("ranks word-prefix matches first, then initials, then loose matches", () => {
    const model: PaletteModel = {
      items: [
        item("Scan a barcode"),
        item("Show sync problems"),
        item("Go to Spools"),
        item("Reload spools from the console"),
      ],
      query: "sp",
      cursor: 0,
    };
    const titles = () => paletteRows(model).map((r) => r.item.title);
    // "sp" starts a word in both Spools rows; Show sync problems only has it as initials.
    expect(titles()).toEqual([
      "Go to Spools",
      "Reload spools from the console",
      "Show sync problems",
    ]);
    model.query = "ssp";
    expect(titles()[0]).toBe("Show sync problems");
    model.query = "go sp";
    expect(titles()).toEqual(["Go to Spools"]);
    model.query = "barc";
    expect(paletteRows(model)[0]).toEqual({ item: model.items[0], hits: [7, 8, 9, 10] });
    // Loose: characters in order anywhere, after every better kind of match.
    model.query = "cn";
    expect(titles().sort()).toEqual(["Reload spools from the console", "Scan a barcode"]);
  });

  it("keeps the palette's order without a query", () => {
    const model: PaletteModel = { items: [item("b"), item("a")], query: "", cursor: 0 };
    expect(paletteRows(model).map((r) => r.item.title)).toEqual(["b", "a"]);
  });
});

describe("paletteInput", () => {
  const model: PaletteModel = {
    items: [item("Go to Spools"), item("Go to Add"), item("Quit")],
    query: "",
    cursor: 0,
  };

  it("types, deletes and clears the query, resetting the cursor", () => {
    const typed = paletteInput({ ...model, cursor: 2 }, press("g"), 5);
    expect(typed).toEqual({ type: "update", model: { ...model, query: "g", cursor: 0 } });
    expect(paletteInput({ ...model, query: "go" }, press("backspace"), 5)).toMatchObject({
      model: { query: "g" },
    });
    expect(paletteInput({ ...model, query: "go" }, press("u", { ctrl: true }), 5)).toMatchObject({
      model: { query: "" },
    });
    expect(paletteInput(model, press("space"), 5)).toMatchObject({ model: { query: " " } });
  });

  it("moves within the matches without wrapping", () => {
    expect(paletteInput(model, press("up"), 5)).toMatchObject({ model: { cursor: 0 } });
    expect(paletteInput(model, press("end"), 5)).toMatchObject({ model: { cursor: 2 } });
    expect(paletteInput(model, press("pageDown"), 5)).toMatchObject({ model: { cursor: 2 } });
    expect(paletteInput({ ...model, cursor: 1 }, press("n", { ctrl: true }), 5)).toMatchObject({
      model: { cursor: 2 },
    });
  });

  it("runs the highlighted match, and closes on esc or ctrl+k", () => {
    expect(paletteInput({ ...model, query: "add" }, press("enter"), 5)).toEqual({
      type: "run",
      item: model.items[1],
    });
    expect(paletteInput({ ...model, query: "zzz" }, press("enter"), 5)).toEqual({ type: "none" });
    expect(paletteInput(model, press("esc"), 5)).toEqual({ type: "close" });
    expect(paletteInput(model, press("k", { ctrl: true }), 5)).toEqual({ type: "close" });
  });

  it("closes before sending, switching to the command's tab first", () => {
    const [m] = PALETTE.init(
      [
        item("Print labels", {
          tab: "spools",
          msg: { type: "tab", tab: "spools", msg: { type: "l" } },
        }),
      ],
      ctx(),
    );
    const [, cmds] = PALETTE.update(m, { type: "key", key: press("enter") }, ctx());
    expect(sent(cmds)).toEqual([
      { type: "app/closeOverlay" },
      { type: "app/switchTab", tab: "spools" },
      { type: "tab", tab: "spools", msg: { type: "l" } },
    ]);
  });

  it("takes a paste as one line of query", () => {
    const [m] = PALETTE.init([], ctx());
    const [next] = PALETTE.update(m, { type: "paste", text: "go\nto" }, ctx());
    expect(next.query).toBe("go to");
  });
});

describe("palette rows", () => {
  it("draws the title, the group and the shortcut in aligned columns, the key at the right end", () => {
    const items = [
      item("Scan a barcode", { detail: "Spools", keys: "b" }),
      item("Go to Add", { detail: "Tab" }),
      item("Command palette", { detail: "App", keys: "ctrl+k" }),
    ];
    const layout = paletteLayout(items);
    const text = (index: number) =>
      rowSegments(items[index] as PaletteItem, [], false, 40, layout)
        .map((s) => s.text)
        .join("");
    expect(text(0)).toBe("  Scan a barcode           Spools      b");
    expect(text(1)).toBe("  Go to Add                Tab          ");
    expect(text(2)).toBe("  Command palette          App    ctrl+k");
    for (const index of [0, 1, 2]) expect(text(index)).toHaveLength(40);
  });

  it("names the shell's own groups in title case", () => {
    expect(SHELL_GROUPS).toEqual({ tab: "Tab", data: "Data", app: "App" });
  });
});

describe("help", () => {
  const request: HelpRequest = {
    tab: "spools",
    title: "Spools",
    hints: [{ keys: "l", label: "labels" }],
    typing: false,
  };

  it("wraps at spaces within the width", () => {
    expect(wrap("one two three four", 9)).toEqual(["one two", "three", "four"]);
  });

  it("lays out what the tab is for, its keys, then the global keys", () => {
    const lines = helpLines(request, 60);
    const headings = lines.filter((l) => l.kind === "heading").map((l) => l.text);
    expect(headings).toEqual(["In Spools", "Everywhere"]);
    const keys = lines.flatMap((l) => (l.kind === "key" ? [l.keys] : []));
    expect(keys).toEqual(["l", ...GLOBAL_HELP.map((h) => h.keys)]);
    for (const line of lines)
      if (line.kind === "text") expect(line.text.length).toBeLessThanOrEqual(60);
  });

  it("says that text fields take letters while one has focus", () => {
    const lines = helpLines({ ...request, typing: true }, 60);
    expect(lines.some((l) => l.kind === "text" && l.text.includes("letters, q and ? type"))).toBe(
      true,
    );
  });

  it("scrolls with arrows within bounds and closes on any other key", () => {
    const small = ctx(80, 14);
    const [m] = HELP.init(request, small);
    const [down] = HELP.update(m, { type: "key", key: press("down") }, small);
    expect(down.scroll).toBe(1);
    const [end] = HELP.update(m, { type: "key", key: press("end") }, small);
    const [past] = HELP.update(end, { type: "key", key: press("down") }, small);
    expect(past.scroll).toBe(end.scroll);
    const [, cmds] = HELP.update(m, { type: "key", key: press("x") }, small);
    expect(sent(cmds)).toEqual([{ type: "app/closeOverlay" }]);
    expect(HELP.hints(m, small).map((h) => h.keys)).toEqual(["↑↓", "any key"]);
    expect(HELP.hints(m, ctx(120, 60)).map((h) => h.keys)).toEqual(["any key"]);
  });

  it("says in its bottom border which way there's more, nothing when it all fits", () => {
    const small = ctx(80, 14);
    const [m] = HELP.init(request, small);
    expect(helpNote(m, small)).toBe("↓ more");
    const [down] = HELP.update(m, { type: "key", key: press("down") }, small);
    expect(helpNote(down, small)).toBe("↑↓ more");
    const [end] = HELP.update(m, { type: "key", key: press("end") }, small);
    expect(helpNote(end, small)).toBe("↑ more");
    expect(helpNote(m, ctx(120, 60))).toBe("");
  });

  it("takes the body's full width when narrow, and every row but its border and padding", () => {
    expect(helpSize(ctx(80, 24))).toEqual({ width: 80, rows: 18 });
    expect(helpSize(ctx(120, 36))).toEqual({ width: 76, rows: 30 });
  });
});

describe("confirm", () => {
  const request = {
    title: "Write 2 presets",
    lines: ["~/presets/a.json", "~/presets/b.json"],
    onApply: { type: "app/toast", text: "done" } as const,
    applyLabel: "write",
  };

  it("applies with a, cancels with esc, and ignores other keys", () => {
    const [m] = CONFIRM.init(request, ctx());
    expect(sent(CONFIRM.update(m, { type: "key", key: press("a") }, ctx())[1])).toEqual([
      { type: "app/closeOverlay" },
      { type: "app/toast", text: "done" },
    ]);
    expect(sent(CONFIRM.update(m, { type: "key", key: press("esc") }, ctx())[1])).toEqual([
      { type: "app/closeOverlay" },
    ]);
    expect(CONFIRM.update(m, { type: "key", key: press("q") }, ctx())[1]).toEqual([]);
    expect(CONFIRM.hints(m, ctx()).map((h) => `${h.keys} ${h.label}`)).toEqual([
      "a write",
      "esc cancel",
    ]);
  });

  it("is as wide as its longest line, within the terminal", () => {
    expect(confirmWidth(request, 120)).toBe(30);
    expect(confirmWidth({ ...request, lines: ["x".repeat(100)] }, 120)).toBe(80);
    // Narrow: the whole width, never a sliver of the body at each side.
    expect(confirmWidth({ ...request, lines: ["x".repeat(100)] }, 60)).toBe(60);
    expect(confirmWidth({ ...request, lines: ["x".repeat(70)] }, 80)).toBe(80);
  });
});
