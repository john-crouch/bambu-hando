// ABOUTME: Tests for the Spools tab's pure update: the list (cursor, filter, sort, ticks), its actions and its dialogs.
// ABOUTME: Drives update() with press() keys and the tab's own messages, and checks the model and the messages sent.

import { describe, expect, it } from "vitest";

import type { SpoolRecord } from "../src/spoolease.js";
import type { CheckSection } from "../src/syncCheck.js";
import { press } from "../src/tui/core/keys.js";
import type { AppMsg, Ctx, Step, TabMsg } from "../src/tui/core/types.js";
import type { FormValues } from "../src/tui/core/values.js";
import {
  busy,
  capturesText,
  commands,
  cursorIndex,
  hints,
  init,
  modal,
  type SpoolsModel,
  spoolsScreen,
  update,
  visibleRows,
} from "../src/tui/tabs/spools/model.js";
import { fitHints } from "../src/tui/ui/hints.js";
import { consoleOf, FILAMENTS, makeCtx, runCmds, spool } from "./tabSpoolsFixtures.js";

const SPOOLS: SpoolRecord[] = [
  spool({ id: "1", currentWeight: 800, location: "Shelf" }),
  spool({ id: "2", slicerFilament: "P2222222", material: "PLA", brand: "Zeta", colorName: "Blue" }),
  spool({ id: "3", slicerFilament: "", brand: "Mystery", material: "ABS", colorName: "Gray" }),
];

const CTX = makeCtx({ resources: { console: consoleOf(SPOOLS) } });

function start(ctx: Ctx = CTX): SpoolsModel {
  return init(ctx, { query: "" })[0];
}

function key(model: SpoolsModel, what: string, ctx: Ctx = CTX): Step<SpoolsModel> {
  return update(model, { type: "key", key: press(what) }, ctx);
}

/** Presses each key in turn and returns the final model. */
function keys(model: SpoolsModel, what: string[], ctx: Ctx = CTX): SpoolsModel {
  return what.reduce((m, k) => key(m, k, ctx)[0], model);
}

/** The messages a step's commands send right away (send() commands; real work is tested in tabSpoolsCmds). */
async function sent(step: Step<SpoolsModel>): Promise<AppMsg[]> {
  return runCmds(step[1]);
}

function tabMsg(msg: TabMsg, model: SpoolsModel, ctx: Ctx = CTX): Step<SpoolsModel> {
  return update(model, msg, ctx);
}

function highlighted(model: SpoolsModel, ctx: Ctx = CTX): string | undefined {
  const rows = visibleRows(model, ctx);
  return rows[cursorIndex(model, rows)]?.spool.id;
}

describe("init", () => {
  it("asks for the console's spools and the sync check, without forcing a reload", async () => {
    const [model, cmds] = init(CTX, { query: "" });
    expect(await runCmds(cmds)).toEqual([
      { type: "app/load", resource: "console" },
      { type: "app/load", resource: "check" },
    ]);
    expect(model).toMatchObject({ sort: "newest", ticked: [], dialog: null, filtering: false });
  });

  it("asks for nothing when no console is set up", async () => {
    const ctx = makeCtx({ values: { skipSpoolease: true } });
    expect(await runCmds(init(ctx, { query: "" })[1])).toEqual([]);
  });
});

describe("spoolsScreen", () => {
  it("tells apart no console, loading, failed, no spools yet and the list", () => {
    expect(spoolsScreen(makeCtx({ values: { skipSpoolease: true } })).kind).toBe("unset");
    expect(spoolsScreen(makeCtx({ values: { host: "" } })).kind).toBe("unset");
    expect(spoolsScreen(makeCtx()).kind).toBe("loading");
    expect(spoolsScreen(makeCtx({ resources: { console: { state: "loading" } } })).kind).toBe(
      "loading",
    );
    expect(
      spoolsScreen(makeCtx({ resources: { console: { state: "failed", error: "down" } } })),
    ).toEqual({ kind: "failed", error: "down" });
    expect(spoolsScreen(makeCtx({ resources: { console: consoleOf([]) } })).kind).toBe("empty");
    expect(spoolsScreen(CTX).kind).toBe("list");
  });

  it("keeps showing the last spools while reloading or after a failed reload", () => {
    const data = { spools: SPOOLS, filaments: FILAMENTS };
    expect(
      spoolsScreen(makeCtx({ resources: { console: { state: "loading", previous: data } } })),
    ).toMatchObject({ kind: "list", reloading: true });
    expect(
      spoolsScreen(
        makeCtx({ resources: { console: { state: "failed", error: "down", previous: data } } }),
      ),
    ).toMatchObject({ kind: "list", error: "down" });
  });
});

describe("the list", () => {
  it("starts on the newest spool and moves with the arrows", () => {
    let model = start();
    expect(highlighted(model)).toBe("3");
    model = keys(model, ["down"]);
    expect(highlighted(model)).toBe("2");
    model = keys(model, ["end"]);
    expect(highlighted(model)).toBe("1");
    model = keys(model, ["down", "home"]);
    expect(highlighted(model)).toBe("3");
  });

  it("stays on the same spool when a reload brings new ones", () => {
    const model = keys(start(), ["down"]);
    const reloaded = makeCtx({
      resources: { console: consoleOf([...SPOOLS, spool({ id: "4" }), spool({ id: "5" })]) },
    });
    const [next] = update(
      model,
      { type: "app/loaded", resource: "console", result: reloaded.resources.console },
      reloaded,
    );
    expect(highlighted(next, reloaded)).toBe("2");
  });

  it("keeps the cursor's place when its spool is gone", () => {
    const model = keys(start(), ["down"]);
    const reloaded = makeCtx({
      resources: { console: consoleOf(SPOOLS.filter((s) => s.id !== "2")) },
    });
    const [next] = update(
      model,
      { type: "app/loaded", resource: "console", result: reloaded.resources.console },
      reloaded,
    );
    expect(highlighted(next, reloaded)).toBe("1");
  });

  it("filters with /, typing every printable key, and esc clears it", () => {
    let model = key(start(), "/")[0];
    expect(model.filtering).toBe(true);
    expect(capturesText(model)).toBe(true);
    model = keys(model, ["z", "e", "t", "a"]);
    expect(visibleRows(model, CTX).map((r) => r.spool.id)).toEqual(["2"]);
    model = keys(model, ["?", "q"]);
    expect(model.filter.value).toBe("zeta?q");
    expect(visibleRows(model, CTX)).toEqual([]);
    model = keys(model, ["esc"]);
    expect(model.filter.value).toBe("");
    expect(model.filtering).toBe(false);
    expect(capturesText(model)).toBe(false);
  });

  it("takes a paste into the filter like typing, even one that reads like a key name", () => {
    const filtering = key(start(), "/")[0];
    const [model] = update(filtering, { type: "paste", text: "up" }, CTX);
    expect(model.filter.value).toBe("up");
    expect(update(start(), { type: "paste", text: "x" }, CTX)[0].filter.value).toBe("");
  });

  it("filters on location, code and #id too, and enter keeps the filter", () => {
    const typed = (text: string) => visibleRows(keys(start(), ["/", text]), CTX);
    expect(typed("shelf").map((r) => r.spool.id)).toEqual(["1"]);
    expect(typed("p2222").map((r) => r.spool.id)).toEqual(["2"]);
    expect(typed("#3").map((r) => r.spool.id)).toEqual(["3"]);
    const kept = keys(start(), ["/", "shelf", "enter"]);
    expect(kept.filtering).toBe(false);
    expect(kept.filter.value).toBe("shelf");
    // esc clears a kept filter before anything else.
    expect(keys(kept, ["esc"]).filter.value).toBe("");
  });

  it("moves the cursor while filtering, and space types a space there", () => {
    const model = keys(start(), ["/", "acme", "space"]);
    expect(model.filter.value).toBe("acme ");
    expect(model.ticked).toEqual([]);
  });

  it("cycles the sort with s", () => {
    let model = start();
    const order: string[] = [model.sort];
    for (let i = 0; i < 4; i++) {
      model = keys(model, ["s"]);
      order.push(model.sort);
    }
    expect(order).toEqual(["newest", "name", "left", "location", "newest"]);
    expect(visibleRows(keys(start(), ["s"]), CTX).map((r) => r.name)).toEqual([
      "Acme PETG Red",
      "Mystery ABS Gray",
      "Zeta PLA Blue",
    ]);
  });

  it("ticks with space and moves down; esc clears the ticks", () => {
    let model = keys(start(), ["space", "space"]);
    expect(model.ticked).toEqual(["3", "2"]);
    expect(highlighted(model)).toBe("1");
    model = keys(model, ["up", "space"]);
    expect(model.ticked).toEqual(["3"]);
    expect(keys(model, ["esc"]).ticked).toEqual([]);
  });

  it("forgets ticks of spools a reload no longer has", () => {
    const model = keys(start(), ["space", "space"]);
    const reloaded = makeCtx({
      resources: { console: consoleOf(SPOOLS.filter((s) => s.id !== "2")) },
    });
    const [next] = update(
      model,
      { type: "app/loaded", resource: "console", result: reloaded.resources.console },
      reloaded,
    );
    expect(next.ticked).toEqual(["3"]);
  });

  it("opens labels for the ticked spools in list order, else the highlighted one", async () => {
    expect(await sent(key(start(), "l"))).toEqual([
      { type: "app/openLabels", request: { spoolIds: ["3"], fresh: false } },
    ]);
    const ticked = keys(start(), ["end", "space", "home", "space"]);
    expect(await sent(key(ticked, "l"))).toEqual([
      { type: "app/openLabels", request: { spoolIds: ["3", "1"], fresh: false } },
    ]);
  });

  it("reloads the spools and the check with r", async () => {
    expect(await sent(key(start(), "r"))).toEqual([
      { type: "app/load", resource: "console", force: true },
      { type: "app/load", resource: "check", force: true },
    ]);
  });

  it("opens the detail with enter on a narrow terminal, and esc closes it", () => {
    const narrow = { ...CTX, bodyColumns: 80 };
    const model = keys(start(), ["enter"], narrow);
    expect(model.detailOpen).toBe(true);
    expect(keys(model, ["esc"], narrow).detailOpen).toBe(false);
    // Beside the list there's nothing to open.
    expect(keys(start(), ["enter"]).detailOpen).toBe(false);
  });
});

describe("empty states", () => {
  it("sends you to the Settings row that's missing without a console", async () => {
    const to = async (values: Partial<FormValues>) => {
      const ctx = makeCtx({ values });
      return sent(key(start(ctx), "enter", ctx));
    };
    expect(await to({ skipSpoolease: true })).toEqual([
      { type: "app/switchTab", tab: "settings", focus: "spoolease.skip" },
    ]);
    expect(await to({ host: " " })).toEqual([
      { type: "app/switchTab", tab: "settings", focus: "spoolease.host" },
    ]);
    expect(await to({ securityKey: "" })).toEqual([
      { type: "app/switchTab", tab: "settings", focus: "spoolease.key" },
    ]);
    const ctx = makeCtx({ values: { skipSpoolease: true } });
    expect(await sent(key(start(ctx), "l", ctx))).toEqual([]);
    expect(await sent(key(start(ctx), "b", ctx))).toEqual([]);
  });

  it("sends you to the console's address in Settings when it can't be read", async () => {
    const ctx = makeCtx({ resources: { console: { state: "failed", error: "down" } } });
    expect(await sent(key(start(ctx), "enter", ctx))).toEqual([
      { type: "app/switchTab", tab: "settings", focus: "spoolease.host" },
    ]);
  });

  it("sends you to Add when the console has no spools yet", async () => {
    const ctx = makeCtx({ resources: { console: consoleOf([]) } });
    expect(await sent(key(start(ctx), "enter", ctx))).toEqual([
      { type: "app/switchTab", tab: "add" },
    ]);
    expect(await sent(key(start(ctx), "l", ctx))).toEqual([]);
  });

  it("reloads after a failure with r", async () => {
    const ctx = makeCtx({ resources: { console: { state: "failed", error: "down" } } });
    expect(await sent(key(start(ctx), "r", ctx))).toContainEqual({
      type: "app/load",
      resource: "console",
      force: true,
    });
  });
});

describe("more spools like this one", () => {
  it("opens the count dialog for the highlighted spool's filament", () => {
    const model = keys(start(), ["down", "+"]);
    expect(model.dialog).toMatchObject({
      kind: "count",
      count: 1,
      phase: "choose",
      back: null,
      filament: { code: "P2222222", name: "Zeta PLA Blue", count: 1 },
    });
  });

  it("explains instead when the spool has no filament code", async () => {
    const step = key(start(), "+");
    expect(step[0].dialog).toBeNull();
    expect(await sent(step)).toEqual([
      {
        type: "app/toast",
        text: "Spool #3 has no filament code, so a copy couldn't be linked to a preset",
        tone: "warning",
      },
    ]);
  });

  it("steps the count up with ↑ or → and down with ↓ or ←, digits set it, between 1 and 8", () => {
    const open = keys(start(), ["down", "+"]);
    const count = (m: SpoolsModel) => (m.dialog?.kind === "count" ? m.dialog.count : null);
    expect(count(keys(open, ["down"]))).toBe(1);
    expect(count(keys(open, ["up", "up"]))).toBe(3);
    expect(count(keys(open, ["right"]))).toBe(2);
    expect(count(keys(open, ["up", "up", "left"]))).toBe(2);
    expect(count(keys(open, ["5"]))).toBe(5);
    expect(count(keys(open, ["9"]))).toBe(1);
    expect(count(keys(open, ["end"]))).toBe(8);
    expect(count(keys(open, ["8", "up"]))).toBe(8);
  });

  it("closes with esc before applying; enter or a applies", () => {
    const open = keys(start(), ["down", "+"]);
    expect(keys(open, ["esc"]).dialog).toBeNull();
    const [entered, cmds] = key(keys(open, ["up"]), "enter");
    expect(entered.dialog).toMatchObject({ phase: "running", results: [], count: 2 });
    expect(cmds).toHaveLength(1);
    const [applied, applyCmds] = key(keys(open, ["up"]), "a");
    expect(applied.dialog).toMatchObject({ phase: "running", results: [], count: 2 });
    expect(applyCmds).toHaveLength(1);
  });

  it("streams each result into the dialog, then reports the run", async () => {
    const running = key(keys(start(), ["down", "+", "up"]), "a")[0];
    const run = running.dialog?.kind === "count" ? running.dialog.run : -1;
    let [model] = tabMsg({ type: "spools/copy", run, result: { ok: true, id: "7" } }, running);
    expect(model.dialog).toMatchObject({ results: [{ ok: true, id: "7" }] });
    const results = [
      { ok: true, id: "7" },
      { ok: false, error: "Spool storage full" },
    ];
    const done = tabMsg({ type: "spools/copiesDone", run, results, error: "" }, model);
    model = done[0];
    expect(model.dialog).toMatchObject({ phase: "done", results });
    expect(await sent(done)).toEqual([
      {
        type: "app/runFinished",
        summary: {
          ok: false,
          lines: [
            "1 spool of Zeta PLA Blue added to http://127.0.0.1: #7",
            "spool 2 of 2: Spool storage full",
          ],
          exitCode: 1,
        },
      },
      // The dialog shows the outcome, so no toast repeats it.
      { type: "app/load", resource: "console", force: true },
      { type: "app/load", resource: "check", force: true },
    ]);
  });

  it("reports a clean run as ok", async () => {
    const running = key(keys(start(), ["down", "+"]), "a")[0];
    const run = running.dialog?.kind === "count" ? running.dialog.run : -1;
    const done = tabMsg(
      { type: "spools/copiesDone", run, results: [{ ok: true, id: "9" }], error: "" },
      running,
    );
    const msgs = await sent(done);
    expect(msgs[0]).toEqual({
      type: "app/runFinished",
      summary: { ok: true, lines: ["1 spool of Zeta PLA Blue added to http://127.0.0.1: #9"] },
    });
    expect(msgs.map((m) => m.type)).not.toContain("app/toast");
  });

  it("still toasts a run whose dialog is open while another tab is on screen", async () => {
    const running = key(keys(start(), ["down", "+"]), "a")[0];
    const run = running.dialog?.kind === "count" ? running.dialog.run : -1;
    const elsewhere: Ctx = { ...CTX, activeTab: "add" };
    const msg: TabMsg = {
      type: "spools/copiesDone",
      run,
      results: [{ ok: true, id: "9" }],
      error: "",
    };
    const done = tabMsg(msg, running, elsewhere);
    expect((await sent(done)).map((m) => m.type)).toContain("app/toast");
    const here = tabMsg(msg, running, { ...CTX, activeTab: "spools" });
    expect((await sent(here)).map((m) => m.type)).not.toContain("app/toast");
  });

  it("reports a rejected key as a setup error", async () => {
    const running = key(keys(start(), ["down", "+"]), "a")[0];
    const run = running.dialog?.kind === "count" ? running.dialog.run : -1;
    const done = tabMsg(
      {
        type: "spools/copiesDone",
        run,
        results: [],
        error: "SpoolEase key validation failed",
        exitCode: 2,
      },
      running,
    );
    expect(done[0].dialog).toMatchObject({
      phase: "done",
      error: "SpoolEase key validation failed",
    });
    expect((await sent(done))[0]).toEqual({
      type: "app/runFinished",
      summary: {
        ok: false,
        lines: ["No spools of Zeta PLA Blue added: SpoolEase key validation failed"],
        exitCode: 2,
      },
    });
  });

  it("offers labels for the new spools, and esc closes", async () => {
    const running = key(keys(start(), ["down", "+", "up"]), "a")[0];
    const run = running.dialog?.kind === "count" ? running.dialog.run : -1;
    const results = [
      { ok: true, id: "7" },
      { ok: true, id: "8" },
    ];
    const [done] = tabMsg({ type: "spools/copiesDone", run, results, error: "" }, running);
    const labels = key(done, "l");
    expect(labels[0].dialog).toBeNull();
    expect(await sent(labels)).toEqual([
      { type: "app/openLabels", request: { spoolIds: ["7", "8"], fresh: true } },
    ]);
    expect(keys(done, ["esc"]).dialog).toBeNull();
    expect(keys(done, ["enter"]).dialog).toBeNull();
  });

  it("ignores keys while running except esc, and still reports a run whose dialog was closed", async () => {
    const running = key(keys(start(), ["down", "+"]), "a")[0];
    const run = running.dialog?.kind === "count" ? running.dialog.run : -1;
    expect(keys(running, ["a", "l", "down"]).dialog).toEqual(running.dialog);
    const closed = keys(running, ["esc"]);
    expect(closed.dialog).toBeNull();
    const done = tabMsg(
      { type: "spools/copiesDone", run, results: [{ ok: true, id: "9" }], error: "" },
      closed,
    );
    expect(done[0].dialog).toBeNull();
    const msgs = await sent(done);
    expect(msgs.map((m) => m.type)).toEqual([
      "app/runFinished",
      "app/toast",
      "app/load",
      "app/load",
    ]);
    // With the dialog gone, the toast is where the outcome shows.
    expect(msgs[1]).toEqual({
      type: "app/toast",
      text: "1 spool of Zeta PLA Blue added",
      tone: "ok",
    });
  });

  it("ignores results of a run that isn't the dialog's", () => {
    const running = key(keys(start(), ["down", "+"]), "a")[0];
    const [model] = tabMsg(
      { type: "spools/copy", run: 999, result: { ok: true, id: "7" } },
      running,
    );
    expect(model.dialog).toEqual(running.dialog);
  });
});

describe("barcode scan", () => {
  const barcodes = new Map([
    ["0015", { code: "P2222222", name: "Zeta PLA Blue" }],
    ["0099", { code: "P9999999", name: "Old PETG" }],
  ]);

  function scanning(): SpoolsModel {
    const open = key(start(), "b")[0];
    return tabMsg({ type: "spools/barcodes", barcodes }, open)[0];
  }

  it("opens a text field and reads the known barcodes", () => {
    const [model, cmds] = key(start(), "b");
    expect(model.dialog).toMatchObject({ kind: "scan", text: { value: "" }, error: "" });
    expect(capturesText(model)).toBe(true);
    expect(cmds).toHaveLength(1);
    expect(tabMsg({ type: "spools/barcodes", barcodes }, model)[0].barcodes).toBe(barcodes);
  });

  it("explains instead when no spool has a filament code to copy", async () => {
    const ctx = makeCtx({ resources: { console: consoleOf([spool({ slicerFilament: "" })]) } });
    const step = key(start(ctx), "b", ctx);
    expect(step[0].dialog).toBeNull();
    expect(await sent(step)).toEqual([
      {
        type: "app/toast",
        text: "No spool on the console has a filament code to copy",
        tone: "warning",
      },
    ]);
  });

  it("takes every printable key as text, and esc closes", () => {
    const model = keys(scanning(), ["?", "q", "backspace", "a"]);
    expect(model.dialog).toMatchObject({ text: { value: "?a" } });
    expect(keys(model, ["esc"]).dialog).toBeNull();
  });

  it("goes to a known barcode's filament on a scanner burst ending in enter", () => {
    const model = keys(scanning(), ["00", "15\r"]);
    expect(model.dialog).toMatchObject({
      kind: "known",
      barcode: "0015",
      filament: { code: "P2222222" },
      cursor: 0,
    });
  });

  it("offers more of it or a different filament", () => {
    const known = keys(scanning(), ["0015", "enter"]);
    expect(keys(known, ["enter"]).dialog).toMatchObject({
      kind: "count",
      count: 1,
      filament: { code: "P2222222" },
      back: { kind: "scan" },
    });
    expect(keys(known, ["down", "enter"]).dialog).toMatchObject({
      kind: "choose",
      barcode: "0015",
      gone: null,
    });
    expect(keys(known, ["esc"]).dialog).toMatchObject({ kind: "scan", text: { value: "" } });
  });

  it("asks which filament a new barcode is, and normalizes what was typed", () => {
    const model = keys(scanning(), ["ab 12", "enter"]);
    expect(model.dialog).toMatchObject({ kind: "choose", barcode: "AB12", gone: null, cursor: 0 });
    expect(keys(model, ["esc"]).dialog).toMatchObject({ kind: "scan" });
  });

  it("names a learned filament no spool is of any more", () => {
    const model = keys(scanning(), ["0099\n"]);
    expect(model.dialog).toMatchObject({
      kind: "choose",
      barcode: "0099",
      gone: { code: "P9999999", name: "Old PETG" },
    });
  });

  it("looks up a pasted barcode that ends in a line break", () => {
    const [model] = update(scanning(), { type: "paste", text: "0015\n" }, CTX);
    expect(model.dialog).toMatchObject({ kind: "known", barcode: "0015" });
  });

  it("ignores enter on an empty field", () => {
    expect(keys(scanning(), ["enter"]).dialog).toMatchObject({ kind: "scan" });
  });

  it("waits for the known barcodes before looking a scan up", () => {
    const open = keys(start(), ["b", "0015\r"]);
    expect(open.dialog).toMatchObject({ kind: "scan", pending: "0015" });
    const [model] = tabMsg({ type: "spools/barcodes", barcodes }, open);
    expect(model.dialog).toMatchObject({ kind: "known", barcode: "0015" });
  });

  it("chooses with arrows or type-ahead and remembers the answer", () => {
    const choose = keys(scanning(), ["NEW1", "enter"]);
    const typedZ = keys(choose, ["z"]);
    expect(typedZ.dialog).toMatchObject({ cursor: 1 });
    const [saving, cmds] = key(typedZ, "enter");
    expect(saving.dialog).toMatchObject({ kind: "choose", saving: true });
    expect(cmds).toHaveLength(1);
    expect(keys(saving, ["down", "enter"]).dialog).toEqual(saving.dialog);

    const [counted] = tabMsg(
      {
        type: "spools/remembered",
        barcode: "NEW1",
        filament: { code: "P2222222", name: "Zeta PLA Blue" },
      },
      saving,
    );
    expect(counted.dialog).toMatchObject({
      kind: "count",
      filament: { code: "P2222222" },
      back: { kind: "scan" },
    });
    expect(counted.barcodes?.get("NEW1")).toEqual({ code: "P2222222", name: "Zeta PLA Blue" });
    expect(keys(counted, ["esc"]).dialog).toMatchObject({ kind: "scan", text: { value: "" } });
  });

  it("goes back to the scan with the error when the answer can't be saved", () => {
    const saving = keys(scanning(), ["NEW1", "enter", "enter"]);
    const [model] = tabMsg(
      { type: "spools/rememberFailed", barcode: "NEW1", error: "disk full" },
      saving,
    );
    expect(model.dialog).toMatchObject({
      kind: "scan",
      error: "Couldn't remember barcode NEW1: disk full",
    });
  });

  it("goes back to the scan after copies made from a scan, for the next spool", () => {
    const counted = keys(scanning(), ["0015", "enter", "enter"]);
    const running = key(counted, "a")[0];
    const run = running.dialog?.kind === "count" ? running.dialog.run : -1;
    const [done] = tabMsg(
      { type: "spools/copiesDone", run, results: [{ ok: true, id: "9" }], error: "" },
      running,
    );
    expect(keys(done, ["esc"]).dialog).toMatchObject({ kind: "scan", text: { value: "" } });
  });
});

describe("hints and commands", () => {
  const keysOf = (model: SpoolsModel, ctx: Ctx = CTX) => hints(model, ctx).map((h) => h.keys);

  it("lists the list's keys, labels counting the ticks", () => {
    expect(keysOf(keys(start(), ["down"]))).toEqual(["↑↓", "space", "/", "s", "l", "+", "b", "r"]);
    const narrow = { ...CTX, bodyColumns: 80 };
    expect(keysOf(start(narrow), narrow)).toEqual([
      "↑↓",
      "enter",
      "space",
      "/",
      "s",
      "l",
      "b",
      "r",
    ]);
    expect(hints(start(narrow), narrow)[1]).toEqual({
      keys: "enter",
      label: "details",
      primary: true,
    });
    expect(hints(start(), CTX).find((h) => h.keys === "s")?.primary).toBe(true);
    const label = hints(keys(start(), ["space", "space"]), CTX).find((h) => h.keys === "l");
    expect(label?.label).toBe("labels for 2");
    expect(hints(keys(start(), ["down"]), CTX).find((h) => h.keys === "+")).toBeDefined();
  });

  it("leaves out more-like-this for a spool without a filament code", () => {
    expect(keysOf(start())).not.toContain("+");
    expect(keysOf(keys(start(), ["down"]))).toContain("+");
    const ctx = makeCtx({ resources: { console: consoleOf([spool({ slicerFilament: "" })]) } });
    expect(keysOf(start(ctx), ctx)).not.toContain("+");
  });

  it("follows the filter, the empty states and each dialog", () => {
    expect(keysOf(keys(start(), ["/"]))).toEqual(["type", "↑↓", "enter", "esc"]);
    const unset = makeCtx({ values: { skipSpoolease: true } });
    expect(keysOf(start(unset), unset)).toEqual(["enter"]);
    const empty = makeCtx({ resources: { console: consoleOf([]) } });
    expect(keysOf(start(empty), empty)).toEqual(["enter", "r"]);
    const failed = makeCtx({ resources: { console: { state: "failed", error: "down" } } });
    expect(keysOf(start(failed), failed)).toEqual(["r", "enter"]);
    expect(hints(start(failed), failed)[1]?.label).toBe("open Settings");
    expect(keysOf(keys(start(), ["down", "+"]))).toEqual(["↑↓", "1-8", "enter", "esc"]);
    expect(hints(keys(start(), ["down", "+", "up"]), CTX)[2]?.label).toBe("add 2 spools");
    expect(keysOf(keys(start(), ["b"]))).toEqual(["type", "enter", "esc"]);
  });

  it("offers done, not esc as well, once copies are added: both close the dialog", () => {
    const running = key(keys(start(), ["down", "+"]), "a")[0];
    const run = running.dialog?.kind === "count" ? running.dialog.run : -1;
    const results = [{ ok: true, id: "9" }];
    const [done] = tabMsg({ type: "spools/copiesDone", run, results, error: "" }, running);
    expect(keysOf(done)).toEqual(["l", "enter"]);
    const [failed] = tabMsg(
      { type: "spools/copiesDone", run, results: [], error: "down" },
      running,
    );
    expect(keysOf(failed)).toEqual(["enter"]);
  });

  it("offers palette commands that reach this tab", async () => {
    const list = commands(keys(start(), ["down"]), CTX);
    // Reloading is the shell's Data command, not one of these.
    expect(list.map((c) => c.title)).toEqual([
      "Scan a barcode",
      "Labels for the highlighted spool",
      "More spools like this one",
      "Sort spools",
    ]);
    // Each names its shortcut, which the palette shows beside it.
    expect(list.map((c) => c.keys)).toEqual(["b", "l", "+", "s"]);
    const scan = list.find((c) => c.title === "Scan a barcode");
    expect(scan?.msg).toEqual({
      type: "tab",
      tab: "spools",
      msg: { type: "spools/command", action: "scan" },
    });
    const [model, cmds] = tabMsg({ type: "spools/command", action: "scan" }, start());
    expect(model.dialog).toMatchObject({ kind: "scan" });
    expect(cmds.length).toBeGreaterThan(0);
    const unset = makeCtx({ values: { skipSpoolease: true } });
    expect(commands(start(unset), unset)).toEqual([]);
  });
});

describe("dialogs are modal", () => {
  it("is modal while a dialog is open, and q or tab there neither quit nor leave", () => {
    expect(modal(start())).toBe(false);
    const counting = keys(start(), ["down", "+"]);
    expect(modal(counting)).toBe(true);
    for (const what of ["q", "tab"]) {
      const [next, cmds] = key(counting, what);
      expect(next).toEqual(counting);
      expect(cmds).toEqual([]);
    }
    expect(modal(keys(start(), ["b"]))).toBe(true);
  });
});

describe("busy", () => {
  it("says what's being added until the run reports, even with its dialog hidden", () => {
    expect(busy(start())).toBeNull();
    const running = key(keys(start(), ["down", "+", "up"]), "a")[0];
    expect(busy(running)).toBe("Adding 2 spools of Zeta PLA Blue to SpoolEase");
    const hidden = keys(running, ["esc"]);
    expect(hidden.dialog).toBeNull();
    expect(busy(hidden)).toBe("Adding 2 spools of Zeta PLA Blue to SpoolEase");
    const run = running.dialog?.kind === "count" ? running.dialog.run : -1;
    const [done] = tabMsg({ type: "spools/copiesDone", run, results: [], error: "down" }, hidden);
    expect(busy(done)).toBeNull();
  });

  it("says a barcode is being remembered", () => {
    const open = tabMsg({ type: "spools/barcodes", barcodes: new Map() }, key(start(), "b")[0])[0];
    const saving = keys(open, ["NEW1", "enter", "enter"]);
    expect(busy(saving)).toBe("Remembering barcode NEW1");
  });
});

describe("a new barcode's filament isn't on the console", () => {
  it("ends the list with Other…, which goes to Add", async () => {
    const open = tabMsg({ type: "spools/barcodes", barcodes: new Map() }, key(start(), "b")[0])[0];
    const choose = keys(open, ["NEW1", "enter", "end"]);
    expect(choose.dialog).toMatchObject({ kind: "choose", cursor: 2 });
    const step = key(choose, "enter");
    expect(step[0].dialog).toBeNull();
    const msgs = await sent(step);
    expect(msgs[0]).toEqual({ type: "app/switchTab", tab: "add" });
    expect(msgs[1]).toMatchObject({ type: "app/toast", text: expect.stringContaining("NEW1") });
  });
});

describe("deep links", () => {
  it("opens on the spool named by app/switchTab's focus, clearing a filter that hides it", () => {
    const filtered = keys(start(), ["/", "Zeta", "enter"]);
    expect(highlighted(filtered)).toBe("2");
    const [next] = update(filtered, { type: "app/switchTab", tab: "spools", focus: "1" }, CTX);
    expect(highlighted(next)).toBe("1");
    expect(next.filter.value).toBe("");
    const [same] = update(start(), { type: "app/switchTab", tab: "spools", focus: "99" }, CTX);
    expect(same).toEqual(start());
    const [plain] = update(start(), { type: "app/switchTab", tab: "spools" }, CTX);
    expect(plain).toEqual(start());
  });
});

describe("the sync check", () => {
  const problem: CheckSection = {
    key: "csvOnly",
    title: "t",
    why: "w",
    problem: true,
    items: ["a", "b"],
  };
  const ctx = makeCtx({
    resources: {
      console: consoleOf(SPOOLS),
      check: { state: "ready", value: { sections: [problem], warnings: [], presets: [] }, at: 0 },
    },
  });

  it("opens Check with c, offered in the hints and the palette while it has problems", async () => {
    expect(await sent(key(start(ctx), "c", ctx))).toEqual([
      { type: "app/switchTab", tab: "check" },
    ]);
    expect(hints(start(ctx), ctx).find((h) => h.keys === "c")?.label).toBe("see 2 problems");
    expect(
      commands(start(ctx), ctx).find((c) => c.title === "Open Check: 2 sync problems")?.msg,
    ).toEqual({ type: "app/switchTab", tab: "check" });
    expect(hints(start(), CTX).find((h) => h.keys === "c")).toBeUndefined();
    expect(await sent(key(start(), "c"))).toEqual([]);
  });
});

describe("a kept filter", () => {
  it("offers esc to clear it", () => {
    const kept = keys(start(), ["/", "Zeta", "enter"]);
    expect(hints(kept, CTX).find((h) => h.keys === "esc")).toEqual({
      keys: "esc",
      label: "clear filter",
      primary: true,
    });
    expect(hints(start(), CTX).find((h) => h.keys === "esc")).toBeUndefined();
  });

  it("keeps esc clear filter in an 80-column footer, before the tab's actions", () => {
    const narrow = { ...CTX, bodyColumns: 80 };
    const kept = keys(start(narrow), ["/", "Zeta", "enter"], narrow);
    const shown = fitHints(hints(kept, narrow), 80 - 8).map((h) => `${h.keys} ${h.label}`);
    expect(shown).toContain("esc clear filter");
    const order = hints(kept, narrow).map((h) => h.keys);
    expect(order.indexOf("esc")).toBe(order.indexOf("/") + 1);
  });
});

describe("the sort hint", () => {
  it("names the order the list is in when there's room, else stays short", () => {
    const sort = (model: SpoolsModel, ctx = CTX) => hints(model, ctx).find((h) => h.keys === "s");
    expect(sort(start())).toEqual({ keys: "s", label: "sort: newest", primary: true });
    const narrow = { ...CTX, columns: 60, bodyColumns: 60 };
    expect(sort(start(narrow), narrow)).toEqual({ keys: "s", label: "sort", primary: true });
    expect(sort(keys(start(), ["s"]))?.label).toBe("sort: name");
    expect(sort(keys(start(), ["s", "s"]))?.label).toBe("sort: least left");
    expect(sort(keys(start(), ["s", "s", "s"]))?.label).toBe("sort: location");
  });
});

describe("filtering", () => {
  it("says enter done, as every filter does", () => {
    const filtering = keys(start(), ["/"]);
    expect(hints(filtering, CTX).find((h) => h.keys === "enter")?.label).toBe("done");
  });
});
