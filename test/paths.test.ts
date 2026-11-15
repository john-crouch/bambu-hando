// ABOUTME: Tests OS-specific path resolution for BambuStudio config locations.
// ABOUTME: Prevents regressions in Linux/macOS compatibility logic.

import { describe, expect, it } from "vitest";

import { bambuFilamentDir, bambuUserRoot, cacheDir, configDir, tildePath } from "../src/paths.js";

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

describe("cacheDir", () => {
  it("uses ~/.cache on Linux", () => {
    expect(cacheDir("linux", "/home/max", {})).toBe("/home/max/.cache/bambu-hando");
  });

  it("honors XDG_CACHE_HOME on Linux", () => {
    expect(cacheDir("linux", "/home/max", { XDG_CACHE_HOME: "/var/cache/max" })).toBe("/var/cache/max/bambu-hando");
  });

  it("uses Library/Caches on macOS", () => {
    expect(cacheDir("darwin", "/Users/max", { XDG_CACHE_HOME: "/ignored" })).toBe("/Users/max/Library/Caches/bambu-hando");
  });
});

describe("configDir", () => {
  it("uses ~/.config on Linux", () => {
    expect(configDir("linux", "/home/max", {})).toBe("/home/max/.config/bambu-hando");
  });

  it("honors XDG_CONFIG_HOME on Linux", () => {
    expect(configDir("linux", "/home/max", { XDG_CONFIG_HOME: "/etc/max" })).toBe("/etc/max/bambu-hando");
  });

  it("uses Application Support on macOS", () => {
    expect(configDir("darwin", "/Users/max", { XDG_CONFIG_HOME: "/ignored" })).toBe("/Users/max/Library/Application Support/bambu-hando");
  });
});

describe("tildePath", () => {
  it("writes the home folder as ~, and leaves other paths alone", () => {
    expect(tildePath("/home/max/.config/BambuStudio", "/home/max")).toBe("~/.config/BambuStudio");
    expect(tildePath("/home/max", "/home/max")).toBe("~");
    expect(tildePath("/home/maxine/x", "/home/max")).toBe("/home/maxine/x");
    expect(tildePath("/etc/x", "/home/max")).toBe("/etc/x");
  });
});
