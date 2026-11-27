// ABOUTME: Tests reading BambuStudio's installed system profiles and BambuStudio.conf.
// ABOUTME: Uses real system profile files copied from a BambuStudio install.

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { nozzleTypeFor, readBambuStudioConf, SystemProfiles } from "../src/bambuProfiles.js";
import { bambuConfigDir, installBambuStudio, X1C_04, X1C_06 } from "./bambuStudioSetup.js";

describe("SystemProfiles", () => {
  let profiles: SystemProfiles;

  beforeAll(async () => {
    const home = await mkdtemp(join(tmpdir(), "bambu-hando-system-"));
    await installBambuStudio(home);
    profiles = await SystemProfiles.load(bambuConfigDir(home));
  });

  it("lists the printers BambuStudio can instantiate", () => {
    expect(profiles.printers()).toEqual([X1C_04, X1C_06]);
  });

  it("normalizes the bundle version for user presets", () => {
    expect(profiles.version).toBe("2.8.0.9");
  });

  it("resolves a preset through its inherits chain, child values winning", () => {
    const petg = profiles.resolve("Generic PETG");

    expect(petg.filament_id).toBe("GFG99");
    expect(petg.filament_type).toEqual(["PETG"]);
    expect(petg.nozzle_temperature).toEqual(["255"]);
    expect(petg.temperature_vitrification).toEqual(["70"]);
    expect(petg.compatible_printers).toContain(X1C_04);
    expect(Object.keys(petg).length).toBeGreaterThan(130);
  });

  it.each([
    ["PETG", "Generic PETG"],
    ["PLA", "Generic PLA"],
    ["PLA-CF", "Generic PLA-CF"],
    ["HIPS", "Generic HIPS @BBL X1C"],
    ["PLA+", "Generic PLA"],
    ["ABS+", "Generic ABS"],
    ["TPU-95A", "Generic TPU"],
  ])("picks the Generic template for %s", (material, template) => {
    expect(profiles.template(material, X1C_04)?.name).toBe(template);
  });

  it("names each printer preset's model and nozzle from its machine preset", () => {
    expect(profiles.printerModel(X1C_04)).toEqual({ model: "Bambu Lab X1 Carbon", nozzleMm: 0.4 });
    expect(profiles.printerModel(X1C_06)).toEqual({ model: "Bambu Lab X1 Carbon", nozzleMm: 0.6 });
    expect(profiles.printerModel("Bambu Lab A1 0.4 nozzle")).toBeNull();
  });

  it("has no template for unknown materials or printers", () => {
    expect(profiles.template("PVB", X1C_04)).toBeNull();
    expect(profiles.template("PETG", "Bambu Lab A1 0.4 nozzle")).toBeNull();
  });

  it("explains how to fix a missing system profile folder", async () => {
    const empty = await mkdtemp(join(tmpdir(), "bambu-hando-nostudio-"));
    await expect(SystemProfiles.load(empty)).rejects.toThrow(
      `BambuStudio system profiles not found in ${join(empty, "system")}: start BambuStudio once so it installs them`,
    );
  });
});

describe("readBambuStudioConf", () => {
  it("reads the logged-in preset folder and the selected printer", async () => {
    const home = await mkdtemp(join(tmpdir(), "bambu-hando-conf-"));
    await installBambuStudio(home, { presetFolder: "1234567890", machine: X1C_06 });

    expect(await readBambuStudioConf(bambuConfigDir(home))).toEqual({
      presetFolder: "1234567890",
      printer: X1C_06,
      nozzleTypes: {},
    });
  });

  it("reads each printer's nozzle type, the first of several, skipping what isn't text", async () => {
    const home = await mkdtemp(join(tmpdir(), "bambu-hando-conf-"));
    await installBambuStudio(home, null);
    const conf = {
      presets: { machine: X1C_04 },
      nozzle_volume_types: {
        [X1C_04]: "High Flow",
        [X1C_06]: "Standard",
        "Bambu Lab H2D 0.4 nozzle": "Standard,High Flow",
        broken: 3,
      },
    };
    await writeFile(join(bambuConfigDir(home), "BambuStudio.conf"), JSON.stringify(conf), "utf-8");
    expect((await readBambuStudioConf(bambuConfigDir(home))).nozzleTypes).toEqual({
      [X1C_04]: "High Flow",
      [X1C_06]: "Standard",
      "Bambu Lab H2D 0.4 nozzle": "Standard",
    });
  });

  it("gives a printer's nozzle type, Standard when it's missing or unknown", () => {
    const types = { [X1C_04]: "High Flow", [X1C_06]: "Bogus" };
    expect(nozzleTypeFor(types, X1C_04)).toBe("High Flow");
    expect(nozzleTypeFor(types, X1C_06)).toBe("Standard");
    expect(nozzleTypeFor(types, "Some Printer")).toBe("Standard");
  });

  it("returns nulls when BambuStudio.conf is missing or unreadable", async () => {
    const home = await mkdtemp(join(tmpdir(), "bambu-hando-conf-"));
    expect(await readBambuStudioConf(bambuConfigDir(home))).toEqual({
      presetFolder: null,
      printer: null,
      nozzleTypes: {},
    });

    await installBambuStudio(home, null);
    await writeFile(join(bambuConfigDir(home), "BambuStudio.conf"), "{ not json", "utf-8");
    expect(await readBambuStudioConf(bambuConfigDir(home))).toEqual({
      presetFolder: null,
      printer: null,
      nozzleTypes: {},
    });
  });
});
