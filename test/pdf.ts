// ABOUTME: Reads back the PDFs bambu-hando draws: page sizes, text runs, and filled rectangles.
// ABOUTME: Also rasterizes the rectangles so tests can decode the QR code that was actually drawn.

import { inflateSync } from "node:zlib";

import jsQR from "jsqr";

export interface PdfText {
  text: string;
  x: number;
  y: number;
  font: string;
  size: number;
}

export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfPage {
  width: number;
  height: number;
  texts: PdfText[];
  rects: PdfRect[];
}

// WinAnsiEncoding bytes that differ from Latin-1, for the characters labels use.
const WIN_ANSI: Record<number, string> = { 0x85: "…", 0x96: "–", 0x99: "™" };

function decodeHex(hex: string): string {
  const bytes = Buffer.from(hex, "hex");
  return [...bytes].map((b) => WIN_ANSI[b] ?? String.fromCharCode(b)).join("");
}

function objects(pdf: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const m of pdf.matchAll(/(\d+) 0 obj\n([\s\S]*?)\nendobj/g)) map.set(Number(m[1]), m[2]!);
  return map;
}

function streamOf(body: string, raw: Buffer, pdf: string): string {
  const start = pdf.indexOf(body) + body.indexOf("stream\n") + "stream\n".length;
  const end = pdf.indexOf("\nendstream", start);
  const data = raw.subarray(start, end);
  return (body.includes("/FlateDecode") ? inflateSync(data) : data).toString("latin1");
}

/** Text runs and filled rectangles per page, in PDFKit's top-left page coordinates. */
export function readPdf(raw: Buffer): PdfPage[] {
  const pdf = raw.toString("latin1");
  const objs = objects(pdf);
  const pages: PdfPage[] = [];
  for (const body of objs.values()) {
    if (!/\/Type \/Page\b/.test(body)) continue;
    const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(body)!;
    const contents = objs.get(Number(/\/Contents (\d+) 0 R/.exec(body)![1]))!;
    const ops = streamOf(contents, raw, pdf);
    const resources = objs.get(Number(/\/Resources (\d+) 0 R/.exec(body)?.[1])) ?? body;
    const fontNames = new Map<string, string>();
    for (const m of resources.matchAll(/\/(F\d+) (\d+) 0 R/g)) {
      fontNames.set(
        m[1]!,
        /\/BaseFont \/([\w-]+)/.exec(objs.get(Number(m[2])) ?? "")?.[1] ?? m[1]!,
      );
    }
    const height = Number(box[2]);
    const texts: PdfText[] = [];
    for (const m of ops.matchAll(
      /BT\n1 0 0 1 ([\d.-]+) ([\d.-]+) Tm\n\/(F\d+) ([\d.]+) Tf\n\[([^\]]*)\] TJ\nET/g,
    )) {
      const hex = [...m[5]!.matchAll(/<([0-9a-f]*)>/g)].map((h) => h[1]).join("");
      // PDFKit flips the page so y grows downward, then places each run by its baseline.
      texts.push({
        text: decodeHex(hex),
        x: Number(m[1]),
        y: height - Number(m[2]),
        font: fontNames.get(m[3]!) ?? m[3]!,
        size: Number(m[4]),
      });
    }
    const rects = [...ops.matchAll(/([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) re/g)].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
      width: Number(m[3]),
      height: Number(m[4]),
    }));
    pages.push({ width: Number(box[1]), height, texts, rects });
  }
  return pages;
}

/** Paints a page's rectangles black on white and decodes the QR code in them, or null. */
export function decodeQr(page: PdfPage, scale = 4): string | null {
  const width = Math.round(page.width * scale);
  const height = Math.round(page.height * scale);
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const r of page.rects) {
    for (let y = Math.round(r.y * scale); y < Math.round((r.y + r.height) * scale); y++) {
      for (let x = Math.round(r.x * scale); x < Math.round((r.x + r.width) * scale); x++) {
        pixels.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
      }
    }
  }
  // jsqr is CommonJS: Node's default import is module.exports, which carries the decoder as .default.
  return jsQR.default(pixels, width, height)?.data ?? null;
}
