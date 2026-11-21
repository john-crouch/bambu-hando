// ABOUTME: Tests the remembered TUI choices (printers presets are written for, empty spool weights) reused between runs.
// ABOUTME: Missing or damaged settings fall back to none, so the form uses BambuStudio's selected printer.

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

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

  it("remembers the console's host, port and HTTPS, each change kept beside the rest", async () => {
    await saveTuiSettings({ printers: ["Printer A 0.4 nozzle"] });
    await rememberConsole({ host: "10.0.0.5" });
    await rememberConsole({ port: 8080 });
    await rememberConsole({ https: true });
    await rememberWeight("sunlu", { kind: "source" });
    await saveTuiSettings({ printers: ["Printer B 0.4 nozzle"] });
    expect(await loadTuiSettings()).toEqual({
      printers: ["Printer B 0.4 nozzle"],
      weights: { sunlu: { kind: "source" } },
      console: { host: "10.0.0.5", port: 8080, https: true },
    });
  });

  it("forgets the host when it's saved empty, and keeps changes made at once", async () => {
    await Promise.all([
      rememberConsole({ host: "spoolease.local" }),
      rememberConsole({ port: 81 }),
      rememberConsole({ https: false }),
    ]);
    expect((await loadTuiSettings()).console).toEqual({
      host: "spoolease.local",
      port: 81,
      https: false,
    });
    await rememberConsole({ host: "  " });
    expect((await loadTuiSettings()).console).toEqual({ port: 81, https: false });
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
