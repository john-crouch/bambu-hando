// ABOUTME: Unit tests of the shell's pure update: tab switching, key and overlay routing, toasts, quitting, resources.
// ABOUTME: Drives createShell with recording fake tabs and injected loaders, so no terminal or network is involved.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaletteItem } from "../src/tui/app/messages.js";
import type { AnyLabels, AnyTab } from "../src/tui/app/registry.js";
import type { Loaders } from "../src/tui/app/resources.js";
import {
  createShell,
  exitCode,
  landingTab,
  type ShellDeps,
  type ShellModel,
  type ShellMsg,
  summaryText,
} from "../src/tui/app/shell.js";
import { type KeyPress, press } from "../src/tui/core/keys.js";
import type { Cmd } from "../src/tui/core/program.js";
import {
  type AppMsg,
  type Ctx,
  TAB_ORDER,
  type TabId,
  type TabMsg,
} from "../src/tui/core/types.js";
import { values } from "./shellFixtures.js";

function NoView(): never {
  throw new Error("not rendered in update tests");
}

interface FakeModel {
  seen: string[];
  typing: boolean;
  writing?: boolean;
  /** A dialog of the tab's own is open ("m" opens it, esc closes it). */
  dialog?: boolean;
  /** Unsaved changes ("u" makes one more). */
  edits?: number;
}

/** A tab that records every message it gets; "t" toggles a text field, "!" asks for a toast. */
function fakeTab(id: TabId): AnyTab {
  return {
    id,
    title: id[0]?.toUpperCase() + id.slice(1),
    init: () => [{ seen: [], typing: false }, []],
    update(model: FakeModel, msg: AppMsg | TabMsg) {
      const label =
        msg.type === "key"
          ? `key:${(msg.key as KeyPress).name ?? (msg.key as KeyPress).input}`
          : msg.type === "app/loaded"
            ? `loaded:${String(msg.resource)}:${(msg.result as { state: string }).state}`
            : msg.type === "app/switchTab" && msg.focus !== undefined
              ? `app/switchTab:${String(msg.focus)}`
              : msg.type;
      const next = { ...model, seen: [...model.seen, label] };
      if (msg.type === "key" && (msg.key as KeyPress).input === "t" && !model.typing)
        return [{ ...next, typing: true }, []];
      if (msg.type === "key" && (msg.key as KeyPress).name === "esc")
        return [{ ...next, typing: false, dialog: false }, []];
      if (msg.type === "key" && (msg.key as KeyPress).input === "m")
        return [{ ...next, dialog: true }, []];
      if (msg.type === "key" && (msg.key as KeyPress).input === "u")
        return [{ ...next, edits: (model.edits ?? 0) + 1 }, []];
      if (msg.type === "write/start") return [{ ...next, writing: true }, []];
      if (msg.type === "write/done") return [{ ...next, writing: false }, []];
      if (msg.type === "key" && (msg.key as KeyPress).input === "!")
        return [next, [(d) => d({ type: "app/toast", text: "hi", tone: "ok" })]];
      return [next, []];
    },
    View: NoView,
    hints: () => [{ keys: "x", label: `do ${id}`, primary: true }],
    capturesText: (model: FakeModel) => model.typing,
    busy: (model: FakeModel) => (model.writing ? `Writing ${id}` : null),
    modal: (model: FakeModel) => model.dialog === true,
    unsaved: (model: FakeModel) => model.edits ?? 0,
    commands: () => [
      { title: `${id} thing`, keys: "z", msg: { type: "tab", tab: id, msg: { type: "thing" } } },
    ],
  };
}

const fakeLabels: AnyLabels = {
  id: "labels",
  init: (request) => [{ request, seen: [] as string[] }, []],
  update: (model, msg) => [{ ...model, seen: [...model.seen, msg.type] }, []],
  View: NoView,
  hints: () => [],
};

function idleLoaders(): Loaders {
  return { console: () => null, presets: () => null, catalog: () => null, check: () => null };
}

function deps(overrides: Partial<ShellDeps> = {}): ShellDeps {
  return {
    tabs: Object.fromEntries(TAB_ORDER.map((id) => [id, fakeTab(id)])) as Record<TabId, AnyTab>,
    labels: fakeLabels,
    loaders: idleLoaders(),
    now: () => 1_000,
    toastMs: 4_000,
    ...overrides,
  };
}

/** Runs an update and every command it returns (and theirs), collecting the final model. */
async function drive(
  shell: ReturnType<typeof createShell>,
  start: ShellModel,
  ...msgs: ShellMsg[]
): Promise<ShellModel> {
  let model = start;
  const queue: ShellMsg[] = [...msgs];
  while (queue.length > 0) {
    const [next, cmds] = shell.update(model, queue.shift() as ShellMsg);
    model = next;
    for (const cmd of cmds) await (cmd as Cmd<ShellMsg>)((m) => queue.push(m));
  }
  return model;
}

const key = (what: string, mods = {}): ShellMsg => ({ type: "key", key: press(what, mods) });
const seen = (model: ShellModel, tab: TabId): string[] => (model.tabs[tab] as FakeModel).seen;

/** The open confirm dialog's request. */
function confirmRequest(model: ShellModel): { title: string; lines: string[] } {
  if (model.overlay?.id !== "confirm") throw new Error("no confirm dialog open");
  return (model.overlay.model as { request: { title: string; lines: string[] } }).request;
}

function start(overrides = {}, d = deps()) {
  const shell = createShell(d);
  const [model] = shell.init(values(overrides), { query: "" }, { columns: 80, rows: 24 });
  return { shell, model, d };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("landingTab", () => {
  it("lands on spools with a console and no search, else on add", () => {
    expect(landingTab(values(), { query: "" })).toBe("spools");
    expect(landingTab(values(), { query: "polymaker" })).toBe("add");
    expect(landingTab(values({ skipSpoolease: true }), { query: "" })).toBe("add");
    expect(landingTab(values({ securityKey: "" }), { query: "" })).toBe("add");
    expect(landingTab(values({ source: "profiles.json" }), { query: "" })).toBe("add");
  });
});

describe("exitCode", () => {
  it("is the highest code any run asks for", () => {
    expect(exitCode([])).toBe(0);
    expect(exitCode([{ ok: true, lines: [] }])).toBe(0);
    expect(
      exitCode([
        { ok: true, lines: [] },
        { ok: false, lines: [] },
      ]),
    ).toBe(1);
    expect(
      exitCode([
        { ok: false, lines: [], exitCode: 2 },
        { ok: false, lines: [] },
      ]),
    ).toBe(2);
  });
});

describe("summaryText", () => {
  it("prints each run's lines, a blank line between runs, nothing without runs", () => {
    expect(summaryText([])).toBe("");
    expect(
      summaryText([
        { ok: true, lines: ["Done: 3 written"] },
        { ok: false, lines: ["Failed: 1", "  x"] },
      ]),
    ).toBe("Done: 3 written\n\nFailed: 1\n  x\n");
  });
});

describe("tabs", () => {
  it("cycles with tab and shift+tab, keeping each tab's model", async () => {
    let { shell, model } = start();
    expect(model.active).toBe("spools");
    model = await drive(shell, model, key("down"), key("tab"), key("tab"));
    expect(model.active).toBe("presets");
    model = await drive(shell, model, key("tab", { shift: true }), key("tab", { shift: true }));
    expect(model.active).toBe("spools");
    // Each tab hears it was shown, so it can load what it needs on its first visit.
    expect(seen(model, "spools")).toEqual(["key:down", "app/switchTab"]);
    expect(seen(model, "presets")).toEqual(["app/switchTab"]);
    expect(seen(model, "add")).toEqual(["app/switchTab", "app/switchTab"]);
    model = await drive(shell, model, key("tab", { shift: true }));
    expect(model.active).toBe("settings");
    expect(seen(model, "settings")).toEqual(["app/switchTab"]);
  });

  it("switches on app/switchTab and routes tab messages even to hidden tabs", async () => {
    let { shell, model } = start();
    model = await drive(
      shell,
      model,
      { type: "app/switchTab", tab: "check" },
      { type: "tab", tab: "presets", msg: { type: "presets/done" } },
    );
    expect(model.active).toBe("check");
    expect(seen(model, "presets")).toEqual(["presets/done"]);
    expect(seen(model, "check")).toEqual(["app/switchTab"]);
  });

  it("passes a deep link's focus to the tab it shows; keyboard switches send none", async () => {
    let { shell, model } = start();
    model = await drive(shell, model, {
      type: "app/switchTab",
      tab: "settings",
      focus: "spoolease.host",
    });
    expect(model.active).toBe("settings");
    expect(seen(model, "settings")).toEqual(["app/switchTab:spoolease.host"]);
    model = await drive(shell, model, key("tab"));
    expect(seen(model, "spools")).toEqual(["app/switchTab"]);
  });

  it("sends resize to every tab and keeps the size", async () => {
    let { shell, model } = start();
    model = await drive(shell, model, { type: "resize", columns: 120, rows: 36 });
    expect([model.columns, model.rows]).toEqual([120, 36]);
    for (const id of TAB_ORDER) expect(seen(model, id)).toEqual(["resize"]);
    expect(shell.ctx(model)).toMatchObject({ bodyColumns: 120, bodyRows: 34 });
  });
});

describe("global keys", () => {
  it("quits with q, exiting 0 when every run went well", async () => {
    let { shell, model } = start();
    model = await drive(shell, model, {
      type: "app/runFinished",
      summary: { ok: true, lines: [] },
    });
    model = await drive(shell, model, key("q"));
    expect(model.exit).toBe(0);
  });

  it("won't quit while a tab is writing, even a tab that isn't shown, and says what's running", async () => {
    let { shell, model } = start();
    model = await drive(shell, model, { type: "tab", tab: "add", msg: { type: "write/start" } });
    // Straight from update: drive would also run the toast's expiry.
    const [refused] = shell.update(model, key("q"));
    expect(refused.exit).toBeNull();
    expect(refused.toast?.text).toContain("Writing add");
    expect(refused.toast?.tone).toBe("warning");
    const [alsoRefused] = shell.update(model, { type: "app/quit" });
    expect(alsoRefused.exit).toBeNull();
    model = await drive(shell, model, { type: "tab", tab: "add", msg: { type: "write/done" } });
    model = await drive(shell, model, key("q"));
    expect(model.exit).toBe(0);
  });

  it("gives q, tab, ? and ctrl+k to a tab whose own dialog is open, and the footer only its keys", async () => {
    let { shell, model } = start();
    model = await drive(shell, model, key("m"));
    expect(shell.hints(model).map((h) => h.keys)).toEqual(["x"]);
    model = await drive(shell, model, key("q"), key("tab"), key("?"), key("k", { ctrl: true }));
    expect(model.exit).toBeNull();
    expect(model.active).toBe("spools");
    expect(model.overlay).toBeNull();
    expect(seen(model, "spools")).toEqual(["key:m", "key:q", "key:tab", "key:?", "key:k"]);
    model = await drive(shell, model, key("esc"), key("q"));
    expect(model.exit).toBe(0);
  });

  it("asks before q drops unsaved changes in any tab, and esc stays", async () => {
    let { shell, model } = start();
    model = await drive(shell, model, key("tab"), key("u"), key("u"), key("tab"), key("u"));
    model = await drive(shell, model, key("q"));
    expect(model.exit).toBeNull();
    expect(model.overlay?.id).toBe("confirm");
    const request = confirmRequest(model);
    expect(request.title).toBe("Quit and drop 3 unsaved changes?");
    expect(request.lines.join("\n")).toContain("Add");
    expect(request.lines.join("\n")).toContain("Presets");
    model = await drive(shell, model, key("esc"));
    expect(model.overlay).toBeNull();
    expect(model.exit).toBeNull();
    model = await drive(shell, model, { type: "app/quit" });
    expect(model.overlay?.id).toBe("confirm");
    model = await drive(shell, model, key("q"));
    expect(model.exit).toBe(0);
  });

  it("quits from the unsaved-changes question with a too, and says 1 change in the singular", async () => {
    let { shell, model } = start();
    model = await drive(shell, model, key("u"), key("q"));
    expect(confirmRequest(model).title).toBe("Quit and drop 1 unsaved change?");
    model = await drive(shell, model, key("a"));
    expect(model.exit).toBe(0);
  });

  it("still refuses to quit from the unsaved-changes question while a write runs", async () => {
    let { shell, model } = start();
    model = await drive(shell, model, key("u"), key("q"));
    model = await drive(shell, model, { type: "tab", tab: "add", msg: { type: "write/start" } });
    // Messages applied without running their cmds: drive would also wait out the toast.
    const [, cmds] = shell.update(model, key("q"));
    const sent: ShellMsg[] = [];
    for (const cmd of cmds) await (cmd as Cmd<ShellMsg>)((m) => sent.push(m));
    for (const msg of sent) [model] = shell.update(model, msg);
    expect(model.exit).toBeNull();
    expect(model.toast?.text).toContain("Writing add");
  });

  it("quits with the code of the worst run", async () => {
    let { shell, model } = start();
    model = await drive(
      shell,
      model,
      { type: "app/runFinished", summary: { ok: false, lines: ["boom"] } },
      { type: "app/quit" },
    );
    expect(model.exit).toBe(1);
    expect(model.summaries).toEqual([{ ok: false, lines: ["boom"] }]);
  });

  it("ignores everything once quitting", async () => {
    let { shell, model } = start();
    model = await drive(shell, model, key("q"), key("down"));
    expect(seen(model, "spools")).toEqual([]);
  });

  it("opens help with ? and the palette with ctrl+k", async () => {
    let { shell, model } = start();
    model = await drive(shell, model, key("?"));
    expect(model.overlay?.id).toBe("help");
    model = await drive(shell, model, key("x"));
    expect(model.overlay).toBeNull();
    model = await drive(shell, model, key("k", { ctrl: true }));
    expect(model.overlay?.id).toBe("palette");
  });

  it("gives q, ? and letters to a tab that is taking text, but keeps tab and ctrl+k", async () => {
    let { shell, model } = start();
    model = await drive(shell, model, key("t"), key("q"), key("?"), key("/"));
    expect(model.exit).toBeNull();
    expect(model.overlay).toBeNull();
    expect(seen(model, "spools")).toEqual(["key:t", "key:q", "key:?", "key:/"]);
    model = await drive(shell, model, key("tab"));
    expect(model.active).toBe("add");
    model = await drive(shell, model, key("tab", { shift: true }), key("k", { ctrl: true }));
    expect(model.overlay?.id).toBe("palette");
  });

  it("passes other keys, / and letters to the active tab", async () => {
    let { shell, model } = start();
    model = await drive(shell, model, key("down"), key("enter"), key("/"), key("l"));
    expect(seen(model, "spools")).toEqual(["key:down", "key:enter", "key:/", "key:l"]);
  });

  it("gives a paste to the tab only while it takes text, else to the open overlay", async () => {
    let { shell, model } = start();
    model = await drive(shell, model, { type: "paste", text: "abc" });
    expect(seen(model, "spools")).toEqual([]);
    model = await drive(shell, model, key("t"), { type: "paste", text: "abc" });
    expect(seen(model, "spools")).toEqual(["key:t", "paste"]);
    model = await drive(shell, model, {
      type: "app/openLabels",
      request: { spoolIds: [], fresh: false },
    });
    model = await drive(shell, model, { type: "paste", text: "x" });
    expect(seen(model, "spools")).toEqual(["key:t", "paste"]);
    expect((model.overlay?.model as { seen: string[] } | undefined)?.seen).toEqual(["paste"]);
  });

  it("shows the footer hints of the tab plus the global keys", () => {
    const { shell, model } = start();
    expect(shell.hints(model).map((h) => h.keys)).toEqual(["x", "tab", "ctrl+k", "?", "q"]);
    const footer = shell.footer(model);
    expect(footer.hints.map((h) => h.keys)).toEqual(["x"]);
    expect(footer.global.map((h) => h.keys)).toEqual(["tab", "ctrl+k", "?", "q"]);
  });

  it("drops q and ? from the footer while the tab takes text, and shows only an open overlay's keys", async () => {
    let { shell, model } = start();
    model = await drive(shell, model, key("t"));
    expect(shell.hints(model).map((h) => h.keys)).toEqual(["x", "tab", "ctrl+k"]);
    model = await drive(shell, model, key("k", { ctrl: true }));
    expect(shell.footer(model)).toEqual({
      hints: [
        { keys: "↑↓", label: "move", primary: true },
        { keys: "enter", label: "run", primary: true },
        { keys: "esc", label: "close", primary: true },
      ],
      global: [],
    });
  });
});

describe("escape merged with the next key", () => {
  // Ink holds a lone ESC 20 ms; when the next key's bytes are read with it, it reports one meta key.
  it("splits a meta key back into esc and the key, so neither is lost", async () => {
    let { shell, model } = start();
    model = await drive(shell, model, key("m"), key("q", { meta: true }));
    expect(seen(model, "spools")).toEqual(["key:m", "key:esc"]);
    expect(model.exit).toBe(0);
  });

  it("lets esc close an overlay before the key that came with it lands", async () => {
    let { shell, model } = start();
    model = await drive(shell, model, key("k", { ctrl: true }), key("down", { meta: true }));
    expect(model.overlay).toBeNull();
    expect(seen(model, "spools")).toEqual(["key:down"]);
  });

  it("splits meta arrows, tab and enter too", async () => {
    let { shell, model } = start();
    model = await drive(shell, model, key("down", { meta: true }));
    model = await drive(shell, model, key("enter", { meta: true }));
    expect(seen(model, "spools")).toEqual(["key:esc", "key:down", "key:esc", "key:enter"]);
    model = await drive(shell, model, key("tab", { meta: true }));
    expect(model.active).toBe("add");
  });

  it("keeps word moves (meta ←→ backspace) whole while the tab takes text", async () => {
    let { shell, model } = start();
    model = await drive(
      shell,
      model,
      key("t"),
      key("left", { meta: true }),
      key("backspace", { meta: true }),
    );
    expect(seen(model, "spools")).toEqual(["key:t", "key:left", "key:backspace"]);
  });
});

describe("ctx", () => {
  it("reads the clock for every key, so tabs can time type-ahead", async () => {
    let clock = 1_000;
    const nows: number[] = [];
    const timing: AnyTab = {
      ...fakeTab("spools"),
      update(model: FakeModel, _msg: AppMsg | TabMsg, ctx: Ctx) {
        nows.push(ctx.now);
        return [model, []];
      },
    };
    const d = deps({ now: () => clock, tabs: { ...deps().tabs, spools: timing } });
    let { shell, model } = start({}, d);
    model = await drive(shell, model, key("a"));
    clock = 1_400;
    model = await drive(shell, model, key("b"));
    expect(nows).toEqual([1_000, 1_400]);
  });

  it("hands tabs the settings app/values changed", async () => {
    let { shell, model } = start();
    model = await drive(shell, model, { type: "app/values", values: { createSpools: false } });
    expect(shell.ctx(model).values.createSpools).toBe(false);
  });
});

describe("overlays", () => {
  it("take every key while open, and esc closes the palette", async () => {
    let { shell, model } = start();
    model = await drive(shell, model, key("k", { ctrl: true }), key("q"), key("tab"));
    expect(model.overlay?.id).toBe("palette");
    expect(model.active).toBe("spools");
    expect(model.exit).toBeNull();
    model = await drive(shell, model, key("esc"));
    expect(model.overlay).toBeNull();
    expect(seen(model, "spools")).toEqual([]);
  });

  it("palette lists commands under title-case groups with their shortcuts", async () => {
    let { shell, model } = start();
    model = await drive(shell, model, key("k", { ctrl: true }));
    const items = (model.overlay?.model as { items: PaletteItem[] }).items;
    const find = (title: string) => items.find((i) => i.title === title);
    expect(find("spools thing")).toMatchObject({ detail: "Spools", keys: "z" });
    expect(find("Go to Add")).toMatchObject({ detail: "Tab" });
    expect(find("Reload BambuStudio presets")).toMatchObject({ detail: "Data" });
    expect(find("Help")).toMatchObject({ detail: "App", keys: "?" });
    expect(find("Quit")).toMatchObject({ detail: "App", keys: "q" });
  });

  it("palette runs a tab's command on that tab, switching to it", async () => {
    let { shell, model } = start();
    model = await drive(shell, model, key("k", { ctrl: true }));
    for (const char of "presets thing")
      model = await drive(shell, model, key(char === " " ? "space" : char));
    model = await drive(shell, model, key("enter"));
    expect(model.overlay).toBeNull();
    expect(model.active).toBe("presets");
    expect(seen(model, "presets")).toEqual(["app/switchTab", "thing"]);
  });

  it("confirm applies with a and cancels with esc", async () => {
    let { shell, model } = start();
    const request = {
      title: "Write 2 presets",
      lines: ["~/presets"],
      onApply: { type: "tab", tab: "add", msg: { type: "add/apply" } } as AppMsg,
    };
    model = await drive(shell, model, { type: "app/confirm", request }, key("esc"));
    expect(model.overlay).toBeNull();
    expect(seen(model, "add")).toEqual([]);
    model = await drive(shell, model, { type: "app/confirm", request }, key("a"));
    expect(model.overlay).toBeNull();
    expect(seen(model, "add")).toEqual(["add/apply"]);
  });

  it("opens labels and sends it overlay messages, resizes and loaded data", async () => {
    let { shell, model } = start();
    model = await drive(
      shell,
      model,
      { type: "app/openLabels", request: { spoolIds: ["3"], fresh: true } },
      { type: "overlay", msg: { type: "labels/printed" } },
      { type: "resize", columns: 90, rows: 30 },
      key("down"),
    );
    expect(model.overlay?.id).toBe("labels");
    expect((model.overlay?.model as { seen: string[] } | undefined)?.seen).toEqual([
      "labels/printed",
      "resize",
      "key",
    ]);
    model = await drive(shell, model, { type: "app/closeOverlay" });
    expect(model.overlay).toBeNull();
  });
});

describe("toasts and errors", () => {
  it("clears a toast after toastMs, but not a newer one", async () => {
    vi.useFakeTimers();
    const { shell, model: first } = start();
    const [withToast, cmds] = shell.update(first, { type: "app/toast", text: "✓ saved" });
    expect(withToast.toast?.text).toBe("✓ saved");
    const expired: ShellMsg[] = [];
    for (const cmd of cmds) void (cmd as Cmd<ShellMsg>)((m) => expired.push(m));
    const [newer] = shell.update(withToast, { type: "app/toast", text: "second" });
    vi.advanceTimersByTime(4_000);
    expect(expired).toHaveLength(1);
    const [kept] = shell.update(newer, expired[0] as ShellMsg);
    expect(kept.toast?.text).toBe("second");
    const [cleared] = shell.update(withToast, expired[0] as ShellMsg);
    expect(cleared.toast).toBeNull();
  });

  it("shows an error banner that the next key dismisses and still delivers", async () => {
    let { shell, model } = start();
    model = await drive(shell, model, { type: "app/error", error: "disk full" });
    expect(model.error).toBe("disk full");
    expect(shell.ctx(model).bodyRows).toBe(21);
    model = await drive(shell, model, key("down"));
    expect(model.error).toBeNull();
    expect(seen(model, "spools")).toEqual(["key:down"]);
  });
});

describe("resources", () => {
  function counting(): Loaders & { calls: string[] } {
    const calls: string[] = [];
    const make = (id: string) => (v: { host: string; presetFolder: string; diameter: number }) => {
      calls.push(
        `${id}:${id === "presets" ? v.presetFolder : id === "catalog" ? v.diameter : v.host}`,
      );
      return Promise.resolve({ id } as never);
    };
    return {
      calls,
      console: make("console"),
      presets: make("presets"),
      catalog: make("catalog"),
      check: make("check"),
    };
  }

  it("shows console and presets loading, and loads them once mounted", async () => {
    const loaders = counting();
    let { shell, model } = start({}, deps({ loaders }));
    expect(model.resources.console.state).toBe("loading");
    expect(model.resources.presets.state).toBe("loading");
    expect(model.resources.catalog.state).toBe("idle");
    model = await drive(shell, model, { type: "shell/mounted" });
    expect(loaders.calls).toEqual(["console:10.0.0.5", "presets:default"]);
    expect(model.resources.console).toEqual({
      state: "ready",
      value: { id: "console" },
      at: 1_000,
    });
    expect(seen(model, "add")).toEqual(["loaded:console:ready", "loaded:presets:ready"]);
  });

  it("leaves the console idle when it isn't set up", async () => {
    const loaders = counting();
    let { shell, model } = start({ skipSpoolease: true }, deps({ loaders }));
    expect(model.resources.console.state).toBe("idle");
    model = await drive(shell, model, { type: "shell/mounted" });
    expect(loaders.calls).toEqual(["presets:default"]);
  });

  it("loads catalog and check on first app/load only, and again with force", async () => {
    const loaders = counting();
    let { shell, model } = start({}, deps({ loaders }));
    model = await drive(
      shell,
      model,
      { type: "app/load", resource: "catalog" },
      { type: "app/load", resource: "catalog" },
      { type: "app/load", resource: "check" },
    );
    expect(loaders.calls).toEqual(["catalog:1.75", "check:10.0.0.5"]);
    model = await drive(shell, model, { type: "app/load", resource: "catalog", force: true });
    expect(loaders.calls).toEqual(["catalog:1.75", "check:10.0.0.5", "catalog:1.75"]);
  });

  it("keeps the previous value while reloading and after a failure", async () => {
    let fail = false;
    const loaders: Loaders = {
      ...idleLoaders(),
      presets: () =>
        fail
          ? Promise.reject(new Error("gone"))
          : Promise.resolve({ presets: [], warnings: ["v1"] }),
    };
    const { shell, model: first } = start({}, deps({ loaders }));
    let model = await drive(shell, first, { type: "shell/mounted" });
    fail = true;
    const [loading] = shell.update(model, { type: "app/load", resource: "presets", force: true });
    expect(loading.resources.presets).toEqual({
      state: "loading",
      previous: { presets: [], warnings: ["v1"] },
    });
    model = await drive(shell, model, { type: "app/load", resource: "presets", force: true });
    expect(model.resources.presets).toEqual({
      state: "failed",
      error: "gone",
      previous: { presets: [], warnings: ["v1"] },
    });
  });

  it("drops a load that a newer one replaced", async () => {
    const { shell, model: first } = start();
    let model = await drive(shell, first, { type: "shell/mounted" });
    const gen = model.gens.presets;
    model = await drive(shell, model, {
      type: "shell/loaded",
      resource: "presets",
      gen: gen - 1,
      result: { state: "failed", error: "stale" },
    });
    expect(model.resources.presets.state).not.toBe("failed");
  });

  it("reloads what a settings change affects, if it was loaded", async () => {
    const loaders = counting();
    let { shell, model } = start({}, deps({ loaders }));
    model = await drive(shell, model, { type: "shell/mounted" });
    loaders.calls.length = 0;
    model = await drive(shell, model, { type: "app/values", values: { presetFolder: "mine" } });
    expect(loaders.calls).toEqual(["presets:mine"]);
    expect(model.values.presetFolder).toBe("mine");
    model = await drive(shell, model, { type: "app/load", resource: "check" });
    loaders.calls.length = 0;
    model = await drive(shell, model, { type: "app/values", values: { host: "10.0.0.9" } });
    expect(loaders.calls).toEqual(["console:10.0.0.9", "check:10.0.0.9"]);
    model = await drive(shell, model, { type: "app/values", values: { skipSpoolease: true } });
    expect(model.resources.console.state).toBe("idle");
    expect(model.resources.check.state).toBe("idle");
  });

  it("takes app/loaded from a tab and passes it on", async () => {
    let { shell, model } = start();
    model = await drive(shell, model, {
      type: "app/loaded",
      resource: "catalog",
      result: { state: "ready", value: { profiles: [], warnings: [] }, at: 5 },
    });
    expect(model.resources.catalog.state).toBe("ready");
    expect(seen(model, "settings")).toEqual(["loaded:catalog:ready"]);
  });

  it("badges Check with its problem count", async () => {
    let { shell, model } = start();
    model = await drive(shell, model, {
      type: "app/loaded",
      resource: "check",
      result: {
        state: "ready",
        value: {
          sections: [
            { key: "csvOnly", title: "", why: "", problem: true, items: ["a", "b"] },
            { key: "noCode", title: "", why: "", problem: false, items: ["c"] },
          ],
          warnings: [],
          presets: [],
        },
        at: 5,
      },
    });
    expect(shell.headerTabs(model).find((t) => t.id === "check")?.badge).toBe("2");
  });
});
