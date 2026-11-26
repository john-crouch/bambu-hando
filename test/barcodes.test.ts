// ABOUTME: Tests for remembered spool barcodes: which filament a scanned barcode is, kept in barcodes.json.
// ABOUTME: The Spools tab's scan dialog (and its scanner bursts) is tested with the tab, in tabSpools.test.ts.

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { barcodesPath, loadBarcodes, normalizeBarcode, rememberBarcode } from "../src/barcodes.js";
import { writesSettled } from "../src/pendingWrites.js";

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
    await writeFile(
      barcodesPath(),
      JSON.stringify({ A1: { code: "PA000001", name: "Red" }, B2: "nope", C3: { code: 7 } }),
    );
    expect(await loadBarcodes()).toEqual(new Map([["A1", { code: "PA000001", name: "Red" }]]));

    await writeFile(barcodesPath(), "{");
    expect(await loadBarcodes()).toEqual(new Map());
  });

  it("keeps every barcode remembered at once", async () => {
    await Promise.all([
      rememberBarcode("111", { code: "A", name: "Filament A" }),
      rememberBarcode("222", { code: "B", name: "Filament B" }),
    ]);
    expect([...(await loadBarcodes()).keys()].sort()).toEqual(["111", "222"]);
  });

  it("lets a save finish before the exit, the read of barcodes.json before its write included", async () => {
    const saving = rememberBarcode("111", { code: "A", name: "Filament A" });
    expect(await writesSettled()).toBe(true);
    expect(JSON.parse(await readFile(barcodesPath(), "utf-8"))).toEqual({
      "111": { code: "A", name: "Filament A" },
    });
    await saving;
  });
});
