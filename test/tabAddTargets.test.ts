// ABOUTME: Tests for where an Add run writes: printers, the console's setup and URL, run validation and the targets card.
// ABOUTME: The security key must never appear in anything shown.

import { describe, expect, it } from "vitest";

import {
  consoleOf,
  consoleSetup,
  createsSpools,
  printersOf,
  runError,
  runTargets,
} from "../src/tui/tabs/add/targets.js";
import { values } from "./tabAddHarness.js";

const ready = values({
  skipSpoolease: false,
  host: " 10.0.0.5 ",
  securityKey: "SECRET",
  port: "8080",
});

describe("printersOf", () => {
  it("splits the comma-separated printers and drops blanks", () => {
    expect(printersOf(values({ printerPreset: " A , ,B " }))).toEqual(["A", "B"]);
  });
});

describe("console setup", () => {
  it("is skipped, missing without host or key, else ready with a connection", () => {
    expect(consoleSetup(values())).toBe("skipped");
    expect(consoleSetup(values({ skipSpoolease: false, host: "h" }))).toBe("missing");
    expect(consoleSetup(ready)).toBe("ready");
    expect(consoleOf(values())).toBeNull();
    expect(consoleOf(ready)).toEqual({
      host: "10.0.0.5",
      port: 8080,
      securityKey: "SECRET",
      https: false,
    });
  });

  it("has no connection while the port isn't a whole number from 1 to 65535", () => {
    for (const port of ["", " ", "abc", "0", "80.5", "70000"])
      expect(consoleOf({ ...ready, port })).toBeNull();
    expect(consoleOf({ ...ready, port: " 8080 " })?.port).toBe(8080);
  });

  it("creates spools only with a console", () => {
    expect(createsSpools(ready)).toBe(true);
    expect(createsSpools({ ...ready, createSpools: false })).toBe(false);
    expect(createsSpools(values({ createSpools: true }))).toBe(false);
  });
});

describe("runError", () => {
  it("needs a folder, a printer, and a set-up console unless SpoolEase is skipped", () => {
    expect(runError(values())).toBe("");
    expect(runError(ready)).toBe("");
    expect(runError(values({ presetFolder: " " }))).toMatch(/preset folder/);
    expect(runError(values({ printerPreset: "" }))).toMatch(/printer/);
    expect(runError(values({ skipSpoolease: false }))).toMatch(/host and security key/);
    expect(runError({ ...ready, port: "70000" })).toMatch(/port/);
  });
});

describe("runTargets", () => {
  it("names every target without the key", () => {
    const targets = runTargets({ ...ready, overwritePresets: true });
    expect(targets).toMatchObject({
      printers: ["Bambu Lab X1 Carbon 0.4 nozzle"],
      overwrite: true,
      console: "ready",
      consoleUrl: "http://10.0.0.5:8080",
      createSpools: true,
    });
    expect(targets.presetDir).toMatch(/BambuStudio\/user\/default\/filament\/base$/);
    expect(JSON.stringify(targets)).not.toContain("SECRET");
  });
});
