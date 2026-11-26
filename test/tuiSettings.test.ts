// ABOUTME: Tests the remembered TUI choices (printers presets are written for, empty spool weights) reused between runs.
// ABOUTME: Missing or damaged settings fall back to none, so the form uses BambuStudio's selected printer.

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { writesSettled } from "../src/pendingWrites.js";
import {
  loadTuiSettings,
  rememberConsole,
  rememberWeight,
  saveTuiSettings,
  tuiSettingsPath,
} from "../src/tuiSettings.js";

describe("TUI settings", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "bambu-hando-home-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("XDG_CONFIG_HOME", undefined);
  });

  it("lives in bambu-hando's config directory", () => {
    expect(tuiSettingsPath()).toBe(join(home, ".config", "bambu-hando", "tui.json"));
  });

  it("remembers no printers until a run saves them", async () => {
    expect(await loadTuiSettings()).toEqual({ printers: [] });
  });

  it("saves and loads the printers", async () => {
    await saveTuiSettings({ printers: ["Printer A 0.4 nozzle", "Printer A 0.6 nozzle"] });

    expect(await loadTuiSettings()).toEqual({
      printers: ["Printer A 0.4 nozzle", "Printer A 0.6 nozzle"],
    });
    expect(JSON.parse(await readFile(tuiSettingsPath(), "utf-8"))).toEqual({
      printers: ["Printer A 0.4 nozzle", "Printer A 0.6 nozzle"],
    });
  });

  it("survives saves that overlap, as quick ticks in Settings make them, ending with one whole file", async () => {
    const lists = [["A"], ["A", "B"], ["A", "B", "C"], ["B"], ["C"]];
    await Promise.all(lists.map((printers) => saveTuiSettings({ printers })));

    const saved = JSON.parse(await readFile(tuiSettingsPath(), "utf-8"));
    expect(lists).toContainEqual(saved.printers);
  });

  it.each([
    ["saveTuiSettings", () => saveTuiSettings({ printers: ["A"] }), { printers: ["A"] }],
    [
      "rememberWeight",
      () => rememberWeight("acme", { kind: "unspecified" }),
      { weights: { acme: { kind: "unspecified" } } },
    ],
    ["rememberConsole", () => rememberConsole({ host: "h" }), { console: { host: "h" } }],
  ])(
    "lets %s finish before the exit, the read of tui.json before its write included",
    async (_name, save, saved) => {
      const saving = save();
      // bin.ts waits on writesSettled before it exits: it must not come back while the save is still reading.
      expect(await writesSettled()).toBe(true);
      expect(JSON.parse(await readFile(tuiSettingsPath(), "utf-8"))).toMatchObject(saved);
      await saving;
    },
  );

  it("lets a save queued behind another finish before the exit", async () => {
    const first = saveTuiSettings({ printers: ["A"] });
    const second = rememberConsole({ host: "h" });
    expect(await writesSettled()).toBe(true);
    expect(JSON.parse(await readFile(tuiSettingsPath(), "utf-8"))).toEqual({
      printers: ["A"],
      console: { host: "h" },
    });
    await Promise.all([first, second]);
  });

  it("falls back to no printers for damaged files and values it doesn't know", async () => {
    await mkdir(join(home, ".config", "bambu-hando"), { recursive: true });
    await writeFile(tuiSettingsPath(), "{ not json", "utf-8");
    expect(await loadTuiSettings()).toEqual({ printers: [] });

    await writeFile(
      tuiSettingsPath(),
      JSON.stringify({ printers: ["Printer A 0.4 nozzle", 7, "  "] }),
      "utf-8",
    );
    expect(await loadTuiSettings()).toEqual({ printers: ["Printer A 0.4 nozzle"] });
  });

  it("remembers empty spool weights per brand, and printer saves keep them", async () => {
    await saveTuiSettings({ printers: ["Printer A 0.4 nozzle"] });
    await rememberWeight("polymaker", { kind: "grams", grams: 137 });
    await rememberWeight("sunlu", { kind: "source" });
    await rememberWeight("polymaker", { kind: "grams", grams: 149 });
    expect(await loadTuiSettings()).toEqual({
      printers: ["Printer A 0.4 nozzle"],
      weights: { polymaker: { kind: "grams", grams: 149 }, sunlu: { kind: "source" } },
    });

    await saveTuiSettings({ printers: ["Printer B 0.4 nozzle"] });
    expect(await loadTuiSettings()).toEqual({
      printers: ["Printer B 0.4 nozzle"],
      weights: { polymaker: { kind: "grams", grams: 149 }, sunlu: { kind: "source" } },
    });
  });

  it("keeps every weight when they're remembered at once", async () => {
    await Promise.all(
      ["a", "b", "c", "d"].map((key, grams) => rememberWeight(key, { kind: "grams", grams })),
    );
    expect(Object.keys((await loadTuiSettings()).weights ?? {}).sort()).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("drops damaged weights and keeps the good ones", async () => {
    await mkdir(join(home, ".config", "bambu-hando"), { recursive: true });
    await writeFile(
      tuiSettingsPath(),
      JSON.stringify({
        printers: [],
        weights: {
          a: { kind: "grams", grams: -3 },
          b: { kind: "nope" },
          c: "x",
          d: { kind: "unspecified" },
          e: { kind: "grams", grams: 220.5 },
          "": { kind: "source" },
        },
      }),
      "utf-8",
    );
    expect(await loadTuiSettings()).toEqual({
      printers: [],
      weights: { d: { kind: "unspecified" } },
    });
    await writeFile(tuiSettingsPath(), JSON.stringify({ printers: [], weights: 7 }), "utf-8");
    expect(await loadTuiSettings()).toEqual({ printers: [] });
  });

  it("remembers the console's host, port and HTTPS as one, beside the rest", async () => {
    await saveTuiSettings({ printers: ["Printer A 0.4 nozzle"] });
    await rememberConsole({ host: "10.0.0.5", port: 8080, https: true });
    await rememberWeight("sunlu", { kind: "source" });
    await saveTuiSettings({ printers: ["Printer B 0.4 nozzle"] });
    expect(await loadTuiSettings()).toEqual({
      printers: ["Printer B 0.4 nozzle"],
      weights: { sunlu: { kind: "source" } },
      console: { host: "10.0.0.5", port: 8080, https: true },
    });
  });

  it("replaces the whole saved console, so a port or HTTPS never outlives the host it was saved with", async () => {
    await rememberConsole({ host: "spoolease.local", port: 81, https: true });
    await rememberConsole({ host: "10.0.0.6", port: 80 });
    expect((await loadTuiSettings()).console).toEqual({ host: "10.0.0.6", port: 80 });
    await rememberConsole({ host: "  ", port: 81, https: false });
    expect((await loadTuiSettings()).console).toEqual({ port: 81, https: false });
    await rememberConsole({});
    expect(await loadTuiSettings()).toEqual({ printers: [] });
  });

  it("ends overlapping console saves with one of them whole", async () => {
    const consoles = [
      { host: "a", port: 81, https: true },
      { host: "b", port: 82, https: false },
    ];
    await Promise.all(consoles.map((console) => rememberConsole(console)));
    expect(consoles).toContainEqual((await loadTuiSettings()).console);
  });

  it("never keeps a security key in the file, even one handed to it", async () => {
    await rememberConsole({ host: "h", securityKey: "LEAKME" } as never);
    expect(await readFile(tuiSettingsPath(), "utf-8")).not.toContain("LEAKME");
  });

  it("drops a damaged console and keeps what's good in it", async () => {
    await mkdir(join(home, ".config", "bambu-hando"), { recursive: true });
    await writeFile(
      tuiSettingsPath(),
      JSON.stringify({ printers: [], console: { host: 7, port: 70000, https: "yes" } }),
      "utf-8",
    );
    expect(await loadTuiSettings()).toEqual({ printers: [] });
    await writeFile(
      tuiSettingsPath(),
      JSON.stringify({ printers: [], console: { host: " h ", port: 0, https: true } }),
      "utf-8",
    );
    expect(await loadTuiSettings()).toEqual({ printers: [], console: { host: "h", https: true } });
    await writeFile(tuiSettingsPath(), JSON.stringify({ printers: [], console: "x" }), "utf-8");
    expect(await loadTuiSettings()).toEqual({ printers: [] });
  });
});
