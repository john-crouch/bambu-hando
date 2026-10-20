// ABOUTME: Tests color normalization and conversion behavior.
// ABOUTME: Guards RGB/RGBA behavior for SpoolEase and BambuStudio payloads.

import { describe, expect, it } from "vitest";

import { normalizeRgba, rgbaToHashRgb } from "../src/colors.js";

describe("normalizeRgba", () => {
  it("adds opaque alpha to 6-digit hex", () => {
    expect(normalizeRgba("ignored", "#aabbcc")).toBe("AABBCCFF");
  });

  it("keeps alpha from 8-digit hex", () => {
    expect(normalizeRgba("ignored", "11223344")).toBe("11223344");
  });

  it("falls back to a known color name", () => {
    expect(normalizeRgba(" Red ", undefined)).toBe("FF0000FF");
  });

  it("falls back to the color name when hex is malformed", () => {
    expect(normalizeRgba("blue", "#12345")).toBe("0000FFFF");
  });

  it("defaults to gray for unknown names", () => {
    expect(normalizeRgba("teal", null)).toBe("808080FF");
  });
});

describe("rgbaToHashRgb", () => {
  it("drops alpha and adds a hash", () => {
    expect(rgbaToHashRgb("ffa500ff")).toBe("#FFA500");
  });

  it("defaults to gray for invalid input", () => {
    expect(rgbaToHashRgb("zz")).toBe("#808080");
  });
});
