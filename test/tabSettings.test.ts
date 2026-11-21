// ABOUTME: Tests the Settings tab's model: pages, rows, lists, text fields, the connection test and what persists.
// ABOUTME: Drives update() with key presses through a mini shell; commands run against temp HOMEs and stand-in servers.

import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadLabelSettings } from "../src/labelSettings.js";
import { press } from "../src/tui/core/keys.js";
import { toTab } from "../src/tui/core/types.js";
import { listFor, OTHER, pageRows, shownItems } from "../src/tui/tabs/settings/fields.js";
import { type SettingsModel, settingsLogic } from "../src/tui/tabs/settings/model.js";
import { loadTuiSettings } from "../src/tuiSettings.js";
import { bambuConfigDir, installBambuStudio, X1C_04, X1C_06 } from "./bambuStudioSetup.js";
import { installFakeLp } from "./fakeLp.js";
import {
  type SpoolEaseServer,
  startSpoolEaseServer,
  TEST_SECURITY_KEY,
} from "./spooleaseServer.js";
import { ctxOf, Harness } from "./tabSettingsHarness.js";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "bh-settings-"));
  vi.stubEnv("HOME", home);
  vi.stubEnv("XDG_CONFIG_HOME", undefined);
  await installBambuStudio(home);
  for (const folder of ["default", "1234567"])
    await mkdir(join(bambuConfigDir(home), "user", folder), { recursive: true });
  await installFakeLp(home);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Starts the tab and gives it a key, which loads the lists it reads only once it's used. */
async function start(values = {}): Promise<Harness<SettingsModel>> {
  const h = await Harness.start("settings", settingsLogic, ctxOf(values));
  await h.press("home");
  return h;
}

const rowsOf = (h: Harness<SettingsModel>) => pageRows(h.model.page, h.ctx, h.model);
const valuesSent = (h: Harness<SettingsModel>) => h.of("app/values").map((m) => m.values);

/** Moves the cursor onto a page's row by its label. */
async function onRow(h: Harness<SettingsModel>, label: string): Promise<void> {
  await h.press("home");
  const index = rowsOf(h).findIndex((row) => row.label === label);
  if (index < 0) throw new Error(`no row ${label}`);
  for (let i = 0; i < index; i++) await h.press("down");
}

async function onPage(h: Harness<SettingsModel>, title: string): Promise<void> {
  const pages = ["BambuStudio", "SpoolEase", "Labels", "Import"];
  while (pages.indexOf(title) > pages.indexOf(pageTitle(h))) await h.press("right");
  while (pages.indexOf(title) < pages.indexOf(pageTitle(h))) await h.press("left");
}

function pageTitle(h: Harness<SettingsModel>): string {
  return { bambu: "BambuStudio", spoolease: "SpoolEase", labels: "Labels", import: "Import" }[
    h.model.page
  ];
}

describe("init", () => {
  it("reads the folders and label settings, and the printer lists only once the tab is used", async () => {
    const h = await Harness.start("settings", settingsLogic, ctxOf());
    expect(h.model.folders).toEqual({ state: "ready", value: ["1234567", "default"] });
    expect(h.model.labels).toMatchObject({ state: "ready" });
    expect(h.model.printers).toEqual({ state: "loading" });
    expect(h.model.labelPrinters).toEqual({ state: "loading" });
    const [, cmds] = h.step({
      type: "key",
      key: { name: "down", input: "", ctrl: false, shift: false, meta: false },
    });
    expect(cmds).toHaveLength(2);
    await h.press("down");
    const [, again] = h.step({
      type: "key",
      key: { name: "down", input: "", ctrl: false, shift: false, meta: false },
    });
    expect(again).toHaveLength(0);
  });

  it("puts an open list's cursor on the current value once its items arrive", async () => {
    const h = await Harness.start("settings", settingsLogic, ctxOf({ printerPreset: X1C_06 }));
    const [opened, cmds] = h.step({
      type: "key",
      key: { name: "down", input: "", ctrl: false, shift: false, meta: false },
    });
    h.model = opened;
    await h.press("enter");
    expect(h.model.open).toMatchObject({ field: "printerPreset", cursor: 0 });
    await h.run(cmds);
    const items = shownItems(listFor("printerPreset", h.ctx, h.model), h.model.open);
    expect(items[(h.model.open as { cursor: number }).cursor]?.value).toBe(X1C_06);
  });

  it("reads BambuStudio's folders and printers, the label settings and the CUPS printers", async () => {
    const h = await start();
    expect(h.model.folders).toEqual({ state: "ready", value: ["1234567", "default"] });
    expect(h.model.printers).toMatchObject({ state: "ready" });
    expect(h.model.printers.value).toEqual(expect.arrayContaining([X1C_04, X1C_06]));
    expect(h.model.labels).toEqual({ state: "ready", value: await loadLabelSettings() });
    expect(h.model.labelPrinters).toEqual({
      state: "ready",
      value: ["Label-Printer", "Label-Printer/spools", "Office-Laser"],
    });
    expect(h.sent).toEqual([]);
  });

  it("says why there are no printers when BambuStudio's system profiles are missing", async () => {
    const empty = await mkdtemp(join(tmpdir(), "bh-settings-empty-"));
    vi.stubEnv("HOME", empty);
    const h = await start();
    expect(h.model.printers).toMatchObject({ state: "failed" });
    expect(h.model.folders).toEqual({ state: "ready", value: [] });
    const list = listFor("printerPreset", h.ctx, h.model);
    expect(list.note).toMatch(/system profiles not found/);
    expect(list.items.map((i) => i.value)).toEqual([X1C_04]);
  });
});

describe("pages", () => {
  it("go left and right without wrapping and keep their cursors; esc stays", async () => {
    const h = await start();
    expect(h.model.page).toBe("bambu");
    await h.press("left");
    expect(h.model.page).toBe("bambu");
    await h.press("down", "right");
    expect(h.model.page).toBe("spoolease");
    await h.press("down", "down", "right", "right", "right");
    expect(h.model.page).toBe("import");
    await h.press("esc");
    expect(h.model.page).toBe("import");
    await h.press("left", "left");
    expect(h.model.page).toBe("spoolease");
    expect(h.model.cursors.spoolease).toBe(2);
    await h.press("left");
    expect(h.model.cursors.bambu).toBe(1);
  });

  it("list every setting with its value, the key only as set or not set", async () => {
    const h = await start({ host: "10.0.0.5", securityKey: "SECRETKEY", skipSpoolease: true });
    expect(rowsOf(h).map((r) => [r.label, r.value])).toEqual([
      ["Preset folder", "default"],
      ["Printers", "X1C 0.4"],
      ["Overwrite presets", "off"],
    ]);
    await onPage(h, "SpoolEase");
    expect(rowsOf(h).map((r) => [r.label, r.value, r.dim])).toEqual([
      ["Host", "10.0.0.5", true],
      ["Port", "80", true],
      ["Security key", "set", true],
      ["Use HTTPS", "off", true],
      ["Use SpoolEase", "off", false],
      ["Create spools", "on", true],
    ]);
    await onPage(h, "Labels");
    expect(rowsOf(h).map((r) => [r.label, r.value])).toEqual([
      ["Fields", "QR code, brand, material, color name, temperatures, weight, spool ID"],
      ["Size", "57x32mm"],
      ["Printer", "Don't print"],
      ["Save PDF to", "No PDF"],
    ]);
    await onPage(h, "Import");
    expect(rowsOf(h).map((r) => [r.label, r.value])).toEqual([
      ["File or URL", "none (SpoolmanDB only)"],
      ["Diameter", "1.75 mm"],
    ]);
    const shown = JSON.stringify(
      ["bambu", "spoolease", "labels", "import"].map((page) =>
        pageRows(page as SettingsModel["page"], h.ctx, h.model),
      ),
    );
    expect(shown).not.toContain("SECRETKEY");
    expect(pageRows("spoolease", ctxOf(), h.model)[2]?.value).toBe("not set");
  });

  it("flag missing printers and an unset host", async () => {
    const h = await start({ printerPreset: "" });
    expect(rowsOf(h)[1]).toMatchObject({ value: "none", tone: "warning" });
    await onPage(h, "SpoolEase");
    expect(rowsOf(h)[0]).toMatchObject({ value: "not set", tone: "warning" });
  });

  it("explain the preset folder BambuStudio uses when not logged in", async () => {
    const h = await start();
    expect(rowsOf(h)[0]?.detail).toMatch(/not logged in/);
  });
});

describe("toggles", () => {
  it("flip with enter or space and apply at once", async () => {
    const h = await start();
    await onRow(h, "Overwrite presets");
    await h.press("enter");
    expect(h.ctx.values.overwritePresets).toBe(true);
    await h.press("space");
    expect(valuesSent(h)).toEqual([{ overwritePresets: true }, { overwritePresets: false }]);
    await onPage(h, "SpoolEase");
    await onRow(h, "Use SpoolEase");
    await h.press("enter");
    expect(h.ctx.values.skipSpoolease).toBe(true);
    await onRow(h, "Create spools");
    await h.press("space");
    expect(h.ctx.values.createSpools).toBe(false);
  });
});

describe("the preset folder list", () => {
  it("offers BambuStudio's user folders plus the current one, and choosing applies it", async () => {
    const h = await start({ presetFolder: "elsewhere" });
    await h.press("enter");
    expect(h.model.open).toMatchObject({ kind: "list", field: "presetFolder" });
    const list = listFor("presetFolder", h.ctx, h.model);
    expect(list.multi).toBe(false);
    expect(list.items.map((i) => [i.value, i.detail ?? ""])).toEqual([
      ["1234567", ""],
      ["default", "used when not logged in to BambuStudio"],
      ["elsewhere", ""],
    ]);
    expect(list.ticked).toEqual(["elsewhere"]);
    expect(h.model.open).toMatchObject({ cursor: 2 });
    await h.press("up");
    await h.press("enter");
    expect(h.model.open).toBeNull();
    expect(valuesSent(h)).toEqual([{ presetFolder: "default" }]);
  });

  it("jumps to a name typed quickly, letter by letter", async () => {
    for (const folder of ["demo", "work"])
      await mkdir(join(bambuConfigDir(home), "user", folder), { recursive: true });
    const h = await start();
    await h.press("enter");
    expect(listFor("presetFolder", h.ctx, h.model).items.map((i) => i.value)).toEqual([
      "1234567",
      "default",
      "demo",
      "work",
    ]);
    const at = (now: number) => {
      h.ctx = { ...h.ctx, now };
    };
    at(10_000);
    await h.press("d");
    expect(h.model.open).toMatchObject({ cursor: 2 });
    at(10_300);
    await h.press("e");
    at(10_600);
    await h.press("f");
    expect(h.model.open).toMatchObject({ cursor: 1 });
    at(20_000);
    await h.press("w");
    expect(h.model.open).toMatchObject({ cursor: 3, typed: { text: "w", at: 20_000 } });
  });

  it("jumps by letter, and esc closes it without a change", async () => {
    const h = await start();
    await h.press("enter", "1");
    expect(h.model.open).toMatchObject({ cursor: 0 });
    await h.press("esc");
    expect(h.model.open).toBeNull();
    expect(h.model.page).toBe("bambu");
    expect(valuesSent(h)).toEqual([]);
  });
});

describe("the printers list", () => {
  it("ticks printers with space, applying and remembering each change", async () => {
    const h = await start();
    await onRow(h, "Printers");
    await h.press("enter");
    const list = listFor("printerPreset", h.ctx, h.model);
    expect(list.multi).toBe(true);
    expect(list.items.find((i) => i.value === X1C_06)?.label).toBe("X1C 0.6");
    const index = shownItems(list, h.model.open).findIndex((i) => i.value === X1C_06);
    const cursor = (h.model.open as { cursor: number }).cursor;
    for (let i = cursor; i < index; i++) await h.press("down");
    await h.press("space");
    expect(h.ctx.values.printerPreset).toBe(`${X1C_04}, ${X1C_06}`);
    const saved = JSON.parse(await readFile(join(home, ".config/bambu-hando/tui.json"), "utf-8"));
    expect(saved).toEqual({ printers: [X1C_04, X1C_06] });
    await h.press("enter");
    expect(h.model.open).toBeNull();
  });

  it("keeps at least one printer", async () => {
    const h = await start();
    await onRow(h, "Printers");
    await h.press("enter", "space");
    expect(h.model.error).toBe("Keep at least one printer ticked");
    expect(valuesSent(h)).toEqual([]);
    await h.press("down");
    expect(h.model.error).toBe("");
  });

  it("flags printers BambuStudio doesn't have, and unticking one drops it", async () => {
    const h = await start({ printerPreset: `${X1C_04}, Some Printer` });
    await onRow(h, "Printers");
    await h.press("enter");
    const items = listFor("printerPreset", h.ctx, h.model).items;
    expect(items.at(-1)).toEqual({
      value: "Some Printer",
      label: "Some Printer",
      detail: "not in BambuStudio's printers",
    });
    // Ticked first: X1C 0.4, Some Printer, then the rest.
    await h.press("home", "down", "space");
    expect(h.ctx.values.printerPreset).toBe(X1C_04);
    expect(shownItems(listFor("printerPreset", h.ctx, h.model), h.model.open)[1]?.value).toBe(
      X1C_06,
    );
    expect(h.model.open).toMatchObject({ cursor: 1 });
  });

  it("warns, without stopping, when the printers can't be remembered", async () => {
    vi.stubEnv("XDG_CONFIG_HOME", "/dev/null/nope");
    const h = await start();
    await onRow(h, "Printers");
    await h.press("enter", "down", "space");
    expect(h.ctx.values.printerPreset).toContain(",");
    expect(h.of("app/toast")).toEqual([
      expect.objectContaining({
        tone: "warning",
        text: expect.stringMatching(/^Couldn't remember these printers: /),
      }),
    ]);
  });
});

describe("text fields", () => {
  it("edit on enter, take every printable key, and save on enter", async () => {
    const h = await start();
    await onPage(h, "SpoolEase");
    await h.press("enter");
    expect(settingsLogic.capturesText(h.model)).toBe(true);
    await h.press("s", "p", "q", "?", "l");
    expect(h.model.open).toMatchObject({ kind: "text", value: "spq?l" });
    await h.press("backspace", "backspace", "backspace", "o", "o", "l", ".", "l", "a", "n");
    await h.press("enter");
    expect(settingsLogic.capturesText(h.model)).toBe(false);
    expect(valuesSent(h)).toEqual([{ host: "spool.lan" }]);
  });

  it("cancel on esc, keeping the value", async () => {
    const h = await start({ host: "10.0.0.5" });
    await onPage(h, "SpoolEase");
    await h.press("enter", "x", "esc");
    expect(h.model.open).toBeNull();
    expect(h.model.page).toBe("spoolease");
    expect(valuesSent(h)).toEqual([]);
  });

  it("take a paste, and one ending in a newline saves", async () => {
    const h = await start();
    await onPage(h, "SpoolEase");
    await h.press("enter");
    await h.dispatch({ type: "paste", text: "10.0.24.111\n" });
    expect(h.model.open).toBeNull();
    expect(h.ctx.values.host).toBe("10.0.24.111");
  });

  it("check the port inline and stay open until it's valid", async () => {
    const h = await start();
    await onPage(h, "SpoolEase");
    await onRow(h, "Port");
    await h.press("enter", "backspace", "backspace", "7", "0", "0", "0", "0", "enter");
    expect(h.model.error).toBe("The port is a whole number from 1 to 65535");
    expect(h.model.open).toMatchObject({ kind: "text", value: "70000" });
    await h.press("backspace");
    expect(h.model.error).toBe("");
    await h.press("enter");
    expect(valuesSent(h)).toEqual([{ port: "7000" }]);
  });

  it("never put the security key in a row, a hint or a message", async () => {
    const h = await start({ host: "10.0.0.5", securityKey: "OLDKEY" });
    await onPage(h, "SpoolEase");
    await onRow(h, "Security key");
    await h.press("enter");
    expect(h.model.open).toMatchObject({ kind: "text", field: "securityKey", value: "OLDKEY" });
    await h.press(
      "end",
      "backspace",
      "backspace",
      "backspace",
      "backspace",
      "backspace",
      "backspace",
    );
    for (const c of "NEWKEY") await h.press(c);
    const hints = JSON.stringify(settingsLogic.hints(h.model, h.ctx));
    const rows = JSON.stringify(rowsOf(h));
    await h.press("enter");
    expect(h.ctx.values.securityKey).toBe("NEWKEY");
    const shown = JSON.stringify([
      hints,
      rows,
      rowsOf(h),
      h.sent.filter((m) => m.type !== "app/values"),
    ]);
    expect(shown).not.toContain("NEWKEY");
    expect(shown).not.toContain("OLDKEY");
    expect(rowsOf(h)[2]?.value).toBe("set");
  });
});

describe("what the SpoolEase page keeps for next time", () => {
  /** Types into the row's text field after emptying it, then saves with enter. */
  async function retype(h: Harness<SettingsModel>, label: string, text: string): Promise<void> {
    await onRow(h, label);
    await h.press("enter");
    await h.dispatch({ type: "key", key: press("u", { ctrl: true }) });
    for (const c of text) await h.press(c);
    await h.press("enter");
  }

  it("marks host, port, security key and HTTPS as saved for next time", async () => {
    const h = await start();
    await onPage(h, "SpoolEase");
    const kept = Object.fromEntries(rowsOf(h).map((row) => [row.label, row.kept]));
    expect(kept).toMatchObject({
      Host: true,
      Port: true,
      "Security key": true,
      "Use HTTPS": true,
      "Use SpoolEase": false,
    });
  });

  it("saves host, port and HTTPS to tui.json as each one changes", async () => {
    const h = await start();
    await onPage(h, "SpoolEase");
    await retype(h, "Host", "10.0.0.5");
    await retype(h, "Port", "8080");
    await onRow(h, "Use HTTPS");
    await h.press("enter");
    expect(await loadTuiSettings()).toMatchObject({
      console: { host: "10.0.0.5", port: 8080, https: true },
    });
    await h.press("enter");
    expect((await loadTuiSettings()).console).toEqual({
      host: "10.0.0.5",
      port: 8080,
      https: false,
    });
    expect(h.of("app/toast")).toEqual([]);
  });

  it("keeps a typed key for the session and says why when the keyring can't take it", async () => {
    const h = await start({ host: "10.0.0.5" });
    await onPage(h, "SpoolEase");
    await retype(h, "Security key", "  SESSIONKEY ");
    expect(h.ctx.values.securityKey).toBe("SESSIONKEY");
    const toasts = h.of("app/toast");
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ tone: "warning" });
    expect(toasts[0]?.text).toMatch(/^SpoolEase key kept for this session only: can't use /);
    expect(JSON.stringify(toasts)).not.toContain("SESSIONKEY");
    expect(await loadTuiSettings()).not.toHaveProperty("console.securityKey");
  });

  it("takes a key with spaces inside, trimming only its ends", async () => {
    const h = await start({ securityKey: "OLDKEY" });
    await onPage(h, "SpoolEase");
    await retype(h, "Security key", " TWO WORDS ");
    expect(h.model.error).toBe("");
    expect(h.ctx.values.securityKey).toBe("TWO WORDS");
  });

  it("forgets the key when the field is emptied, warning when the keyring can't be reached", async () => {
    const h = await start({ securityKey: "OLDKEY" });
    await onPage(h, "SpoolEase");
    await retype(h, "Security key", "");
    expect(h.ctx.values.securityKey).toBe("");
    const toasts = h.of("app/toast");
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.text).toMatch(/^Couldn't forget the stored SpoolEase key: can't use /);
    expect(JSON.stringify(toasts)).not.toContain("OLDKEY");
  });
});

describe("testing the connection", () => {
  let server: SpoolEaseServer;
  beforeEach(async () => {
    server = await startSpoolEaseServer();
  });
  afterEach(() => server.close());

  const console = () => ({
    host: "127.0.0.1",
    port: String(server.port),
    securityKey: TEST_SECURITY_KEY,
  });

  it("shows ✓ when the console takes the key", async () => {
    const h = await start(console());
    await onPage(h, "SpoolEase");
    const [testing] = h.step({
      type: "key",
      key: { input: "t", ctrl: false, shift: false, meta: false },
    });
    expect(testing.test).toEqual({ state: "testing" });
    await h.press("t");
    expect(h.model.test).toEqual({
      state: "ok",
      text: `http://127.0.0.1:${server.port} accepts the key`,
    });
    expect(server.requests.map((r) => r.path)).toEqual(["/api/test-key"]);
  });

  it("shows ✗ for a rejected key, without the key", async () => {
    const h = await start({ ...console(), securityKey: "WRONGKEY" });
    await onPage(h, "SpoolEase");
    await h.press("t");
    expect(h.model.test).toEqual({
      state: "failed",
      text: `http://127.0.0.1:${server.port} rejects the security key`,
    });
  });

  it("shows ✗ when the console can't be reached", async () => {
    await server.close();
    const h = await start(console());
    await onPage(h, "SpoolEase");
    await h.press("t");
    expect(h.model.test).toMatchObject({ state: "failed" });
    expect((h.model.test as { text: string }).text).toMatch(
      /^Can't reach http:\/\/127\.0\.0\.1:\d+: /,
    );
    expect(JSON.stringify(h.model.test)).not.toContain(TEST_SECURITY_KEY);
    server = await startSpoolEaseServer();
  });

  it("works with SpoolEase skipped too, and says what's missing first", async () => {
    const h = await start({ ...console(), skipSpoolease: true });
    await onPage(h, "SpoolEase");
    await h.press("t");
    expect(h.model.test).toMatchObject({ state: "ok" });
    const bare = await start();
    await onPage(bare, "SpoolEase");
    await bare.press("t");
    expect(bare.model.error).toBe("Type the console's host first");
    const noKey = await start({ host: "h" });
    await onPage(noKey, "SpoolEase");
    await noKey.press("t");
    expect(noKey.model.error).toBe("Set the security key first");
    const badPort = await start({ host: "h", securityKey: "k", port: "0" });
    await onPage(badPort, "SpoolEase");
    await badPort.press("t");
    expect(badPort.model.error).toBe("The port is a whole number from 1 to 65535");
    expect(badPort.model.test).toEqual({ state: "idle" });
  });

  it("forgets a result once a connection setting changes, and ignores a late one", async () => {
    const h = await start(console());
    await onPage(h, "SpoolEase");
    await h.press("t");
    expect(h.model.test.state).toBe("ok");
    await onRow(h, "Use HTTPS");
    await h.press("enter");
    expect(h.model.test).toEqual({ state: "idle" });
    await h.dispatch({ type: "settings/tested", seq: h.model.testSeq - 1, ok: true, text: "late" });
    expect(h.model.test).toEqual({ state: "idle" });
  });

  it("only takes t on the SpoolEase page", async () => {
    const h = await start(console());
    await h.press("t");
    expect(h.model.test).toEqual({ state: "idle" });
    expect(server.requests).toEqual([]);
  });
});

describe("labels", () => {
  const labelsFile = () => join(home, ".config/bambu-hando/labels.json");

  it("ticks fields, keeping one, and saves each change in label order", async () => {
    const h = await start();
    await onPage(h, "Labels");
    await h.press("enter");
    const list = listFor("labelFields", h.ctx, h.model);
    expect(list.items[0]).toMatchObject({ value: "qr", label: "QR code" });
    await h.press("down", "down", "down", "space");
    const saved = JSON.parse(await readFile(labelsFile(), "utf-8"));
    expect(saved.fields).toEqual([
      "qr",
      "brand",
      "material",
      "name",
      "color",
      "temps",
      "weight",
      "id",
    ]);
    expect(h.model.labels.value?.fields).toEqual(saved.fields);
    expect(h.sent).toEqual([]);
  });

  it("won't untick the last field", async () => {
    const h = await start();
    await onPage(h, "Labels");
    await h.press("enter");
    for (const field of ["qr", "brand", "material", "color", "temps", "weight", "id"]) {
      const index = listFor("labelFields", h.ctx, h.model).items.findIndex(
        (i) => i.value === field,
      );
      await h.press("home");
      for (let i = 0; i < index; i++) await h.press("down");
      await h.press("space");
    }
    expect(h.model.error).toBe("Keep at least one field ticked");
    expect(h.model.labels.value?.fields).toEqual(["id"]);
  });

  it("chooses a size from the list or types another, checked inline", async () => {
    const h = await start();
    await onPage(h, "Labels");
    await onRow(h, "Size");
    await h.press("enter");
    const items = listFor("labelSize", h.ctx, h.model).items;
    expect(items[0]).toEqual({
      value: "57x32mm",
      label: "57x32mm",
      detail: "2.25x1.25in thermal roll",
    });
    expect(items.at(-1)).toEqual({ value: OTHER, label: "Other size…" });
    await h.press("down", "enter");
    expect(h.model.labels.value?.size).toBe("50x30mm");
    await h.press("enter", "end", "enter");
    expect(h.model.open).toMatchObject({ kind: "text", field: "labelSize", value: "50x30mm" });
    for (let i = 0; i < 7; i++) await h.press("backspace");
    await h.press("b", "i", "g", "enter");
    expect(h.model.error).toMatch(/^label size must look like/);
    for (let i = 0; i < 3; i++) await h.press("backspace");
    for (const c of "3x2in") await h.press(c);
    await h.press("enter");
    expect(h.model.open).toBeNull();
    expect(JSON.parse(await readFile(labelsFile(), "utf-8")).size).toBe("3x2in");
    expect(listFor("labelSize", h.ctx, h.model).items.at(-2)).toEqual({
      value: "3x2in",
      label: "3x2in",
      detail: "your size",
    });
  });

  it("chooses a printer from CUPS or none, a saved unknown one flagged", async () => {
    const h = await start();
    await onPage(h, "Labels");
    await onRow(h, "Printer");
    await h.press("enter");
    expect(listFor("labelPrinter", h.ctx, h.model).items.map((i) => i.label)).toEqual([
      "Don't print",
      "Label-Printer",
      "Label-Printer/spools",
      "Office-Laser",
    ]);
    await h.press("down", "enter");
    expect(JSON.parse(await readFile(labelsFile(), "utf-8")).printer).toBe("Label-Printer");
    expect(rowsOf(h)[2]?.value).toBe("Label-Printer");

    await installFakeLp(home, ["Office-Laser"]);
    await h.press("enter");
    expect(listFor("labelPrinter", h.ctx, h.model).items.at(-1)).toEqual({
      value: "Label-Printer",
      label: "Label-Printer",
      detail: "not in CUPS's printers",
    });
  });

  it("says when CUPS has no printers", async () => {
    await installFakeLp(home, []);
    vi.stubEnv("PATH", "/nonexistent");
    const h = await start();
    expect(listFor("labelPrinter", h.ctx, h.model).note).toBe(
      "No printers found (lpstat -e): labels can still be saved as a PDF",
    );
  });

  it("types the PDF path, empty for none", async () => {
    const h = await start();
    await onPage(h, "Labels");
    await onRow(h, "Save PDF to");
    await h.press("enter");
    await h.dispatch({ type: "paste", text: "~/labels.pdf" });
    await h.press("enter");
    expect(JSON.parse(await readFile(labelsFile(), "utf-8")).output).toBe("~/labels.pdf");
    expect(rowsOf(h)[3]?.value).toBe("~/labels.pdf");
  });

  it("warns when the label settings can't be saved", async () => {
    const h = await start();
    vi.stubEnv("XDG_CONFIG_HOME", "/dev/null/nope");
    await onPage(h, "Labels");
    await onRow(h, "Size");
    await h.press("enter", "down", "enter");
    expect(h.of("app/toast")).toEqual([
      expect.objectContaining({
        tone: "warning",
        text: expect.stringMatching(/^Couldn't save the label settings: /),
      }),
    ]);
  });
});

describe("import", () => {
  it("types a file or URL, empty going back to SpoolmanDB only", async () => {
    const h = await start();
    await onPage(h, "Import");
    await h.press("enter");
    expect(h.model.open).toMatchObject({ kind: "text", value: "" });
    await h.dispatch({ type: "paste", text: " ./profiles.json " });
    await h.press("enter");
    expect(h.ctx.values.source).toBe("./profiles.json");
    expect(rowsOf(h)[0]?.value).toBe("./profiles.json");
    await h.press("enter");
    expect(h.model.open).toMatchObject({ value: "./profiles.json" });
    await h.press("home");
    for (let i = 0; i < 15; i++) await h.press("delete");
    await h.press("enter");
    expect(h.ctx.values.source).toBe("spoolmandb");
  });

  it("chooses the diameter from the list or types another", async () => {
    const h = await start();
    await onPage(h, "Import");
    await onRow(h, "Diameter");
    await h.press("enter");
    expect(listFor("diameter", h.ctx, h.model).items.map((i) => i.label)).toEqual([
      "1.75 mm",
      "2.85 mm",
      "Other…",
    ]);
    await h.press("down", "enter");
    expect(h.ctx.values.diameter).toBe(2.85);
    await h.press("enter", "end", "enter", "backspace", "backspace", "backspace", "backspace");
    await h.press("0", "enter");
    expect(h.model.error).toBe("The diameter is a number of millimeters above 0");
    await h.press("backspace", "3", "enter");
    expect(h.ctx.values.diameter).toBe(3);
    expect(listFor("diameter", h.ctx, h.model).items.map((i) => i.label)).toEqual([
      "1.75 mm",
      "2.85 mm",
      "3 mm",
      "Other…",
    ]);
  });
});

describe("hints", () => {
  it("follow the focused row and what's open", async () => {
    const h = await start();
    const keys = () =>
      settingsLogic.hints(h.model, h.ctx).map((hint) => `${hint.keys} ${hint.label}`);
    expect(keys()).toEqual(["↑↓ move", "enter choose", "←→ pages"]);
    await onRow(h, "Overwrite presets");
    expect(keys()).toEqual(["↑↓ move", "enter switch", "←→ pages"]);
    await h.press("right");
    expect(keys()).toEqual(["↑↓ move", "enter edit", "t test connection", "←→ pages"]);
    await h.press("left", "up", "enter");
    expect(keys()).toEqual(["↑↓ move", "space tick", "enter done", "/ filter", "esc close"]);
    await h.press("esc", "up", "enter");
    expect(keys()).toEqual(["↑↓ move", "enter choose", "/ filter", "esc close"]);
    // The filter's enter says what the other tabs' filters say.
    await h.press("/");
    expect(keys()).toEqual(["↑↓ move", "enter done", "esc clear filter"]);
    await h.press("esc", "esc", "right", "enter");
    expect(keys()).toEqual(["enter save", "esc cancel"]);
  });
});

describe("palette commands", () => {
  it("open each page and test the connection", async () => {
    const h = await start();
    const commands = settingsLogic.commands?.(h.model, h.ctx) ?? [];
    expect(commands.map((c) => c.title)).toEqual([
      "Settings: BambuStudio",
      "Settings: SpoolEase",
      "Settings: Labels",
      "Settings: Import",
      "Test the SpoolEase connection",
    ]);
    const labels = commands[2]?.msg;
    expect(labels).toEqual(toTab("settings", { type: "settings/page", page: "labels" }));
    if (labels?.type !== "tab") throw new Error("not a tab message");
    await h.dispatch(labels.msg);
    expect(h.model.page).toBe("labels");
    expect(h.of("app/switchTab")).toEqual([{ type: "app/switchTab", tab: "settings" }]);
  });

  it("closes what's open when a page is opened from the palette", async () => {
    const h = await start();
    await h.press("enter");
    await h.dispatch({ type: "settings/page", page: "import" });
    expect(h.model.open).toBeNull();
    expect(h.model.page).toBe("import");
  });
});
