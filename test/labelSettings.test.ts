// ABOUTME: Tests the remembered label choices (fields, size, printer, PDF path) the TUI reuses between runs.
// ABOUTME: Missing or damaged settings fall back to defaults instead of blocking label printing.

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_LABEL_SETTINGS,
  labelSettingsPath,
  loadLabelSettings,
  saveLabelSettings,
} from "../src/labelSettings.js";

describe("label settings", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "bambu-hando-home-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("XDG_CONFIG_HOME", undefined);
  });

  it("lives in bambu-hando's config directory", () => {
    expect(labelSettingsPath()).toBe(join(home, ".config", "bambu-hando", "labels.json"));
  });

  it("defaults to the standard fields on a 57x32 mm label, no printer and no PDF", async () => {
    expect(await loadLabelSettings()).toEqual({
      fields: ["qr", "brand", "material", "color", "temps", "weight", "id"],
      size: "57x32mm",
      printer: "",
      output: "",
    });
    expect(DEFAULT_LABEL_SETTINGS.size).toBe("57x32mm");
  });

  it("saves and loads the last choices", async () => {
    const choices = {
      fields: ["qr", "brand", "id"] as const,
      size: "40x30mm",
      printer: "Label-Printer/spools",
      output: "/tmp/labels.pdf",
    };
    await saveLabelSettings({ ...choices, fields: [...choices.fields] });

    expect(await loadLabelSettings()).toEqual({ ...choices, fields: [...choices.fields] });
    expect(JSON.parse(await readFile(labelSettingsPath(), "utf-8"))).toEqual({
      ...choices,
      fields: [...choices.fields],
    });
  });

  it("survives saves that overlap, ending with one whole file", async () => {
    const sizes = ["40x30mm", "50x30mm", "57x32mm", "62x29mm"];
    await Promise.all(
      sizes.map((size) => saveLabelSettings({ ...DEFAULT_LABEL_SETTINGS, size })),
    );

    expect(sizes).toContain(JSON.parse(await readFile(labelSettingsPath(), "utf-8")).size);
  });

  it("falls back to defaults for damaged files and values it doesn't know", async () => {
    await mkdir(join(home, ".config", "bambu-hando"), { recursive: true });
    await writeFile(labelSettingsPath(), "{ not json", "utf-8");
    expect(await loadLabelSettings()).toEqual(DEFAULT_LABEL_SETTINGS);

    await writeFile(
      labelSettingsPath(),
      JSON.stringify({ fields: ["brand", "price", "id"], size: "huge", printer: 7 }),
      "utf-8",
    );
    expect(await loadLabelSettings()).toEqual({
      ...DEFAULT_LABEL_SETTINGS,
      fields: ["brand", "id"],
    });
  });
});
