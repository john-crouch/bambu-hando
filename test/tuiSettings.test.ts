// ABOUTME: Tests the remembered TUI choices (the printers presets are written for) reused between runs.
// ABOUTME: Missing or damaged settings fall back to none, so the form uses BambuStudio's selected printer.

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadTuiSettings, saveTuiSettings, tuiSettingsPath } from "../src/tuiSettings.js";

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

    expect(await loadTuiSettings()).toEqual({ printers: ["Printer A 0.4 nozzle", "Printer A 0.6 nozzle"] });
    expect(JSON.parse(await readFile(tuiSettingsPath(), "utf-8"))).toEqual({ printers: ["Printer A 0.4 nozzle", "Printer A 0.6 nozzle"] });
  });

  it("falls back to no printers for damaged files and values it doesn't know", async () => {
    await mkdir(join(home, ".config", "bambu-hando"), { recursive: true });
    await writeFile(tuiSettingsPath(), "{ not json", "utf-8");
    expect(await loadTuiSettings()).toEqual({ printers: [] });

    await writeFile(tuiSettingsPath(), JSON.stringify({ printers: ["Printer A 0.4 nozzle", 7, "  "] }), "utf-8");
    expect(await loadTuiSettings()).toEqual({ printers: ["Printer A 0.4 nozzle"] });
  });
});
