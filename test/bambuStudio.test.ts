// ABOUTME: Tests BambuStudio preset building and writing, including dry-run side effects.
// ABOUTME: Preset JSON must match the Python reference output byte for byte.

import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { presetJson, presetPath, writeFilamentPreset, writeMany } from "../src/bambuStudio.js";
import { parity, parityProfiles, profileAt } from "./parity.js";

const PRINTER = parity.printer_preset;

describe("presetJson", () => {
  it.each(parityProfiles.map((p, i) => [p.name, i] as const))("matches Python output for %s", (_name, index) => {
    expect(presetJson(profileAt(index), PRINTER)).toBe(parity.presets[index]);
  });
});

describe("preset files", () => {
  let filamentDir: string;

  beforeEach(async () => {
    const home = await mkdtemp(join(tmpdir(), "bambu-hando-home-"));
    vi.stubEnv("HOME", home);
    filamentDir = join(home, ".config", "BambuStudio", "user", "default", "filament");
  });

  it("sanitizes unsafe filename characters", () => {
    expect(presetPath(profileAt(1), "default", PRINTER)).toBe(join(filamentDir, `Caf_ Cr_me PLA @ ${PRINTER}.json`));
  });

  it("dry-run returns the target without touching disk", async () => {
    const path = await writeFilamentPreset(profileAt(0), "default", "X1C", true);

    expect(path).toBe(join(filamentDir, "PETG Red @ X1C.json"));
    await expect(readdir(filamentDir)).rejects.toThrow("ENOENT");
  });

  it("apply creates the directory and writes the preset atomically", async () => {
    const path = await writeFilamentPreset(profileAt(0), "default", PRINTER, false);

    expect(await readFile(path, "utf-8")).toBe(parity.presets[0]);
    expect(await readdir(filamentDir)).toEqual([`PETG Red @ ${PRINTER}.json`]);
  });

  it("writeMany reports filesystem errors per profile", async () => {
    await mkdir(join(filamentDir, ".."), { recursive: true });
    await writeFile(filamentDir, "not a directory", "utf-8");

    const outcomes = await writeMany([profileAt(0)], "default", "X1C", false);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.path).toBe(join(filamentDir, "PETG Red @ X1C.json"));
    expect(outcomes[0]?.error).toContain("EEXIST");
  });

  it("writeMany reports no error on success", async () => {
    const outcomes = await writeMany([profileAt(0)], "default", "X1C", false);

    expect(outcomes).toEqual([{ path: join(filamentDir, "PETG Red @ X1C.json"), error: "" }]);
  });
});
