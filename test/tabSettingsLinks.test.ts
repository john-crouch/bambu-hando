// ABOUTME: Tests the Settings tab's deep links, its label settings staying in step with labels.json, and list filtering.
// ABOUTME: Also the printer list's order, Use SpoolEase, page keys and the short values; temp HOMEs, no real settings.

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { press } from "../src/tui/core/keys.js";
import { listFor, pageRows, shownItems } from "../src/tui/tabs/settings/fields.js";
import { settingsLayout } from "../src/tui/tabs/settings/layout.js";
import { type SettingsModel, settingsLogic } from "../src/tui/tabs/settings/model.js";
import { bambuConfigDir, installBambuStudio, X1C_04, X1C_06 } from "./bambuStudioSetup.js";
import { installFakeLp } from "./fakeLp.js";
import { ctxOf, Harness } from "./tabSettingsHarness.js";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "bh-settings-links-"));
  vi.stubEnv("HOME", home);
  vi.stubEnv("XDG_CONFIG_HOME", undefined);
  await installBambuStudio(home);
  await mkdir(join(bambuConfigDir(home), "user", "default"), { recursive: true });
  await installFakeLp(home);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function start(values = {}): Promise<Harness<SettingsModel>> {
  const h = await Harness.start("settings", settingsLogic, ctxOf(values));
  await h.press("home");
  return h;
}

const focusedLabel = (h: Harness<SettingsModel>) =>
  pageRows(h.model.page, h.ctx, h.model)[h.model.cursors[h.model.page]]?.label;

const labelsFile = () => join(home, ".config/bambu-hando/labels.json");

describe("deep links", () => {
  it("open the page and row a focus names", async () => {
    const h = await start();
    const cases: [string, SettingsModel["page"], string][] = [
      ["spoolease.host", "spoolease", "Host"],
      ["spoolease.port", "spoolease", "Port"],
      ["spoolease.key", "spoolease", "Security key"],
      ["spoolease.https", "spoolease", "Use HTTPS"],
      ["spoolease.skip", "spoolease", "Use SpoolEase"],
      ["spoolease.spools", "spoolease", "Create spools"],
      ["bambu.folder", "bambu", "Preset folder"],
      ["bambu.printers", "bambu", "Printers"],
      ["bambu.overwrite", "bambu", "Overwrite presets"],
      ["labels.fields", "labels", "Fields"],
      ["labels.size", "labels", "Size"],
      ["labels.printer", "labels", "Printer"],
      ["labels.output", "labels", "Save PDF to"],
      ["import.source", "import", "File or URL"],
      ["import.diameter", "import", "Diameter"],
    ];
    for (const [focus, page, label] of cases) {
      await h.dispatch({ type: "app/switchTab", tab: "settings", focus });
      expect([focus, h.model.page, focusedLabel(h)]).toEqual([focus, page, label]);
    }
  });

  it("open a page by its id, keeping its cursor, and close what was open", async () => {
    const h = await start();
    await h.press("right", "down", "down", "enter");
    expect(h.model.open?.kind).toBe("text");
    await h.dispatch({ type: "app/switchTab", tab: "settings", focus: "labels" });
    expect(h.model.page).toBe("labels");
    expect(h.model.open).toBeNull();
    await h.dispatch({ type: "app/switchTab", tab: "settings", focus: "spoolease" });
    expect(focusedLabel(h)).toBe("Security key");
  });

  it("ignore a focus they don't know", async () => {
    const h = await start();
    await h.dispatch({ type: "app/switchTab", tab: "settings", focus: "nope.nothing" });
    expect(h.model.page).toBe("bambu");
    expect(h.model.cursors.bambu).toBe(0);
  });
});

describe("label settings changed elsewhere", () => {
  it("are read again each time the tab is shown", async () => {
    const h = await start();
    expect(h.model.labels.value?.printer).toBe("");
    await mkdir(join(home, ".config/bambu-hando"), { recursive: true });
    await writeFile(labelsFile(), JSON.stringify({ printer: "DYMO", output: "~/l.pdf" }));
    await h.dispatch({ type: "app/switchTab", tab: "settings" });
    expect(h.model.labels.value).toMatchObject({ printer: "DYMO", output: "~/l.pdf" });
  });

  it("survive a change made here: it's merged into what labels.json holds now", async () => {
    const h = await start();
    await h.press("right", "right");
    expect(h.model.page).toBe("labels");
    // The labels overlay saves a printer after this tab last read the file.
    await mkdir(join(home, ".config/bambu-hando"), { recursive: true });
    await writeFile(labelsFile(), JSON.stringify({ printer: "DYMO" }));
    await h.press("down", "enter");
    await moveTo(
      h,
      listFor("labelSize", h.ctx, h.model).items.findIndex((i) => i.value === "40x30mm"),
    );
    await h.press("enter");
    const saved = JSON.parse(await readFile(labelsFile(), "utf-8"));
    expect(saved).toMatchObject({ printer: "DYMO", size: "40x30mm" });
    expect(h.model.labels.value).toMatchObject({ printer: "DYMO", size: "40x30mm" });
  });

  it("keep both of two changes saved back to back", async () => {
    const h = await start();
    await h.press("right", "right", "down", "enter");
    await moveTo(
      h,
      listFor("labelSize", h.ctx, h.model).items.findIndex((i) => i.value === "40x30mm"),
    );
    const [afterSize, sizeCmds] = h.step({ type: "key", key: press("enter") });
    h.model = afterSize;
    await h.press("down", "enter");
    const printers = listFor("labelPrinter", h.ctx, h.model).items;
    await moveTo(
      h,
      printers.findIndex((i) => i.value !== ""),
    );
    const [afterPrinter, printerCmds] = h.step({ type: "key", key: press("enter") });
    h.model = afterPrinter;
    await Promise.all([h.run(sizeCmds), h.run(printerCmds)]);
    const saved = JSON.parse(await readFile(labelsFile(), "utf-8"));
    expect(saved.size).toBe("40x30mm");
    expect(saved.printer).not.toBe("");
  });
});

/** Moves an open list's cursor down to an item. */
async function moveTo(h: Harness<SettingsModel>, index: number): Promise<void> {
  expect(index).toBeGreaterThanOrEqual(0);
  const open = h.model.open;
  for (let i = open?.kind === "list" ? open.cursor : 0; i < index; i++) await h.press("down");
}

describe("the printers list", () => {
  it("puts ticked printers first, then by model and nozzle, short names; ticking doesn't move rows", async () => {
    const h = await start({ printerPreset: X1C_06 });
    await h.press("down", "enter");
    const labels = () =>
      shownItems(listFor("printerPreset", h.ctx, h.model), h.model.open).map((i) => i.label);
    expect(labels()).toEqual(["X1C 0.6", "X1C 0.4"]);
    await h.press("down", "space");
    expect(h.ctx.values.printerPreset).toBe(`${X1C_04}, ${X1C_06}`);
    expect(labels()).toEqual(["X1C 0.6", "X1C 0.4"]);
  });

  it("filters with /, typing goes to the filter, enter keeps it, esc clears it", async () => {
    const h = await start();
    await h.press("down", "enter", "/");
    expect(settingsLogic.capturesText(h.model)).toBe(true);
    await h.press("0", ".", "6");
    const shown = () => shownItems(listFor("printerPreset", h.ctx, h.model), h.model.open);
    expect(shown().map((i) => i.label)).toEqual(["X1C 0.6"]);
    await h.press("enter");
    expect(settingsLogic.capturesText(h.model)).toBe(false);
    expect(shown()).toHaveLength(1);
    await h.press("space");
    expect(h.ctx.values.printerPreset).toBe(`${X1C_04}, ${X1C_06}`);
    await h.press("esc");
    expect(shown()).toHaveLength(2);
    expect(h.model.open?.kind).toBe("list");
    await h.press("esc");
    expect(h.model.open).toBeNull();
  });

  it("shows the printers row short", async () => {
    const h = await start({ printerPreset: `${X1C_04}, ${X1C_06}` });
    expect(pageRows("bambu", h.ctx, h.model)[1]?.value).toBe("X1C 0.4, 0.6");
  });
});

describe("pages and rows", () => {
  it("say Use SpoolEase, on when SpoolEase isn't skipped", async () => {
    const h = await start();
    await h.press("right");
    const row = () =>
      pageRows("spoolease", h.ctx, h.model).find((r) => r.field === "skipSpoolease");
    expect(row()).toMatchObject({ label: "Use SpoolEase", on: true });
    await h.dispatch({ type: "app/switchTab", tab: "settings", focus: "spoolease.skip" });
    await h.press("enter");
    expect(h.ctx.values.skipSpoolease).toBe(true);
    expect(row()).toMatchObject({ on: false, value: "off" });
  });

  it("leave esc alone on a page: ← goes back, and no esc hint", async () => {
    const h = await start();
    await h.press("right", "right", "esc");
    expect(h.model.page).toBe("labels");
    expect(settingsLogic.hints(h.model, h.ctx).some((x) => x.keys === "esc")).toBe(false);
  });

  it("spell No PDF in sentence case", async () => {
    const h = await start();
    expect(pageRows("labels", h.ctx, h.model).find((r) => r.field === "labelOutput")?.value).toBe(
      "No PDF",
    );
  });
});

describe("the layout", () => {
  it("puts the explanation under the rows below 90 columns, side by side from 90", () => {
    const narrow = { ...ctxOf(), bodyColumns: 80, columns: 80 };
    expect(settingsLayout(narrow, "spoolease")).toMatchObject({
      stacked: true,
      left: 80,
      right: 80,
    });
    const wide = { ...ctxOf(), bodyColumns: 120, columns: 120, bodyRows: 34 };
    expect(settingsLayout(wide, "spoolease")).toMatchObject({ stacked: false });
  });
});
