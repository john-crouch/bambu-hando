// ABOUTME: Tests the spool label PDF: one page per label at the label size, a scannable QR, and fitted text.
// ABOUTME: Reads the generated PDF back and decodes the QR code that was drawn, rather than trusting the encoder.

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { listPrinters, renderLabelsPdf } from "../src/labelPdf.js";
import { type LabelContent, parseLabelSize } from "../src/labels.js";
import { installFakeLp } from "./fakeLp.js";
import { decodeQr, readPdf } from "./pdf.js";

const URL = "https://tag.spoolease.io/S1/?ID=1&M=PETG&CC=F1C400FF&CN=2%2E0%20Vivid%20Yellow&B=Sunlu&WL=1000&WE=189&SC=P4840583";

const label: LabelContent = {
  qr: URL,
  lines: [
    { field: "brand", text: "Sunlu", style: "title" },
    { field: "material", text: "PETG", style: "strong" },
    { field: "color", text: "2.0 Vivid Yellow", style: "normal" },
    { field: "temps", text: "230–250 °C", style: "normal" },
    { field: "weight", text: "1000 g", style: "normal" },
    { field: "id", text: "Spool #1", style: "small" },
  ],
};

describe("renderLabelsPdf", () => {
  it("draws one page per label at the label size", async () => {
    const pages = readPdf(await renderLabelsPdf([label, { ...label, qr: null }], parseLabelSize("2.5x1.5in")));

    expect(pages.map((p) => [p.width, p.height])).toEqual([
      [180, 108],
      [180, 108],
    ]);
  });

  it("draws a QR code that scans as the spool link", async () => {
    const [page] = readPdf(await renderLabelsPdf([label], parseLabelSize("2.5x1.5in")));

    expect(decodeQr(page!)).toBe(URL);
  });

  it("fits the QR code and every line on a 57x32 mm label", async () => {
    const size = parseLabelSize("57x32mm");
    const [page] = readPdf(await renderLabelsPdf([label], size));

    expect(decodeQr(page!)).toBe(URL);
    expect(page!.texts).toHaveLength(6);
    for (const text of page!.texts) {
      expect(text.y).toBeGreaterThan(0);
      expect(text.y).toBeLessThan(size.height);
    }
    for (const r of page!.rects) expect(r.x + r.width).toBeLessThan(size.width);
  });

  it("keeps the QR code scannable on small labels", async () => {
    const [page] = readPdf(await renderLabelsPdf([label], parseLabelSize("40x30mm")));

    expect(decodeQr(page!)).toBe(URL);
  });

  it("writes the lines top to bottom beside the QR code, all inside the label", async () => {
    const [page] = readPdf(await renderLabelsPdf([label], parseLabelSize("2.5x1.5in")));
    const qrRight = Math.max(...page!.rects.map((r) => r.x + r.width));

    expect(page!.texts.map((t) => t.text)).toEqual(["Sunlu", "PETG", "2.0 Vivid Yellow", "230–250 °C", "1000 g", "Spool #1"]);
    expect(page!.texts.map((t) => t.font)).toEqual(["Helvetica-Bold", "Helvetica-Bold", "Helvetica", "Helvetica", "Helvetica", "Helvetica"]);
    for (const [i, text] of page!.texts.entries()) {
      expect(text.x).toBeGreaterThan(qrRight);
      expect(text.y).toBeGreaterThan(0);
      expect(text.y).toBeLessThan(108);
      if (i > 0) expect(text.y).toBeGreaterThan(page!.texts[i - 1]!.y);
    }
    expect(page!.texts[0]!.size).toBeGreaterThan(page!.texts[2]!.size);
  });

  it("uses the whole width for text when the QR code is left out", async () => {
    const [page] = readPdf(await renderLabelsPdf([{ ...label, qr: null }], parseLabelSize("2.5x1.5in")));

    expect(page!.rects).toEqual([]);
    expect(page!.texts[0]!.x).toBeLessThan(10);
  });

  it("shrinks long text to fit, then cuts it off with an ellipsis", async () => {
    const long = "A very long note about drying this spool at sixty five degrees for eight hours before every print";
    const [page] = readPdf(
      await renderLabelsPdf([{ qr: URL, lines: [{ field: "note", text: long, style: "small" }] }], parseLabelSize("2.5x1.5in")),
    );

    const [note] = page!.texts;
    expect(note!.text.endsWith("…")).toBe(true);
    expect(long.startsWith(note!.text.slice(0, -1))).toBe(true);
    expect(note!.size).toBeGreaterThanOrEqual(5);
  });

  it("fits many lines by making all of them smaller", async () => {
    const lines = Array.from({ length: 14 }, (_, i) => ({ field: "note" as const, text: `Line ${i + 1}`, style: "normal" as const }));
    const [page] = readPdf(await renderLabelsPdf([{ qr: null, lines }], parseLabelSize("2.5x1.5in")));

    expect(page!.texts).toHaveLength(14);
    expect(page!.texts.at(-1)!.y).toBeLessThan(108);
  });
});

describe("listPrinters", () => {
  it("lists CUPS destinations, printer instances included", async () => {
    await installFakeLp(await mkdtemp(join(tmpdir(), "bambu-hando-lp-")));

    expect(await listPrinters()).toEqual(["Label-Printer", "Label-Printer/spools", "Office-Laser"]);
  });

  it("lists none without CUPS", async () => {
    vi.stubEnv("PATH", await mkdtemp(join(tmpdir(), "bambu-hando-empty-")));

    expect(await listPrinters()).toEqual([]);
  });
});
