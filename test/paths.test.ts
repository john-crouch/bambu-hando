// ABOUTME: Tests OS-specific path resolution for BambuStudio config locations.
// ABOUTME: Prevents regressions in Linux/macOS compatibility logic.

import { describe, expect, it } from "vitest";

import { bambuFilamentDir, bambuUserRoot } from "../src/paths.js";

describe("bambuUserRoot", () => {
  it("uses ~/.config on Linux", () => {
    expect(bambuUserRoot("linux", "/home/max")).toBe("/home/max/.config/BambuStudio/user");
  });

  it("uses Application Support on macOS", () => {
    expect(bambuUserRoot("darwin", "/Users/max")).toBe("/Users/max/Library/Application Support/BambuStudio/user");
  });

  it("rejects unsupported platforms", () => {
    expect(() => bambuUserRoot("win32", "C:\\Users\\max")).toThrow("Unsupported OS for this tool: win32");
  });
});

describe("bambuFilamentDir", () => {
  it("appends the preset folder and filament directory", () => {
    expect(bambuFilamentDir("default", "linux", "/home/max")).toBe("/home/max/.config/BambuStudio/user/default/filament");
  });
});
