// ABOUTME: Tests the remembered TUI choices (printers presets are written for, empty spool weights) reused between runs.
// ABOUTME: Missing or damaged settings fall back to none, so the form uses BambuStudio's selected printer.

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  loadTuiSettings,
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
});
