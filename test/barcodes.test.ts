// ABOUTME: Tests for remembered spool barcodes (which filament a scanned barcode is) and the scan screen's keys.
// ABOUTME: A scanner types the whole code and enter in one burst, which reaches the app as one input.

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { Key } from "ink";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { barcodesPath, loadBarcodes, normalizeBarcode, rememberBarcode } from "../src/barcodes.js";
import { scanInput } from "../src/tui/BarcodeScan.js";

function key(overrides: Partial<Key> = {}): Key {
  return overrides as Key;
}

describe("normalizeBarcode", () => {
  it("ignores case and spaces, so a typed code matches a scanned one", () => {
    expect(normalizeBarcode(" 0015 0603z ")).toBe("00150603Z");
  });
});

describe("remembered barcodes", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "bambu-hando-home-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("XDG_CONFIG_HOME", undefined);
  });

  it("lives in bambu-hando's config directory and starts empty", async () => {
    expect(barcodesPath()).toBe(join(home, ".config", "bambu-hando", "barcodes.json"));
    expect(await loadBarcodes()).toEqual(new Map());
  });

  it("remembers which filament a barcode is, replacing an earlier answer", async () => {
    await rememberBarcode("00150603Z", { code: "PA000001", name: "Sunlu PETG Red" });
    await rememberBarcode("4000000000001", { code: "PB000002", name: "Acme PLA Blue" });
    await rememberBarcode("00150603Z", { code: "PA000003", name: "Sunlu PETG Elite Red" });

    expect(await loadBarcodes()).toEqual(
      new Map([
        ["00150603Z", { code: "PA000003", name: "Sunlu PETG Elite Red" }],
        ["4000000000001", { code: "PB000002", name: "Acme PLA Blue" }],
      ]),
    );
  });

  it("skips damaged entries and treats a damaged file as empty", async () => {
    await mkdir(dirname(barcodesPath()), { recursive: true });
    await writeFile(barcodesPath(), JSON.stringify({ A1: { code: "PA000001", name: "Red" }, B2: "nope", C3: { code: 7 } }));
    expect(await loadBarcodes()).toEqual(new Map([["A1", { code: "PA000001", name: "Red" }]]));

    await writeFile(barcodesPath(), "{");
    expect(await loadBarcodes()).toEqual(new Map());
  });
});

describe("scanInput", () => {
  it("types a code a key at a time and submits it with enter", () => {
    expect(scanInput("0015", "0", key())).toEqual({ type: "update", code: "00150" });
    expect(scanInput("00150603Z", "", key({ return: true }))).toEqual({ type: "submit", code: "00150603Z" });
  });

  it("takes a scanner's burst, code and enter in one input, as a whole scan", () => {
    expect(scanInput("", "00150603Z\r", key())).toEqual({ type: "submit", code: "00150603Z" });
    expect(scanInput("", "00150603Z\n", key())).toEqual({ type: "submit", code: "00150603Z" });
  });

  it("deletes with backspace, ignores enter on nothing, and goes back with esc", () => {
    expect(scanInput("001", "", key({ backspace: true }))).toEqual({ type: "update", code: "00" });
    expect(scanInput("  ", "", key({ return: true }))).toEqual({ type: "none" });
    expect(scanInput("001", "", key({ escape: true }))).toEqual({ type: "back" });
  });
});
