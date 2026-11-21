// ABOUTME: Draws spool labels into a PDF, one page per label at the label's exact size, and prints it with CUPS.
// ABOUTME: The QR code is vector rectangles and the text is a base-14 font, so any printer renders it crisply.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import PDFDocument from "pdfkit";
import { create } from "qrcode";

import type { LabelContent, LabelSize, LineStyle } from "./labels.js";

const FONTS: Record<LineStyle, string> = {
  title: "Helvetica-Bold",
  strong: "Helvetica-Bold",
  normal: "Helvetica",
  small: "Helvetica",
};
// Font sizes on a 1.5 in (108 pt) tall label; other heights scale them.
const SIZES: Record<LineStyle, number> = { title: 14, strong: 11, normal: 9, small: 7 };
const REFERENCE_HEIGHT = 108;
const LINE_HEIGHT = 1.2;
const MIN_FONT_SIZE = 5;
const ELLIPSIS = "…";

// Fills one horizontal run of dark modules per rectangle, which keeps the PDF small and seam-free.
function drawQr(doc: PDFKit.PDFDocument, text: string, x: number, y: number, side: number): void {
  const { modules } = create(text, { errorCorrectionLevel: "M" });
  const module = side / modules.size;
  for (let row = 0; row < modules.size; row++) {
    let col = 0;
    while (col < modules.size) {
      if (!modules.get(row, col)) {
        col++;
        continue;
      }
      const start = col;
      while (col < modules.size && modules.get(row, col)) col++;
      doc.rect(x + start * module, y + row * module, (col - start) * module, module);
    }
  }
  doc.fill("black");
}

/** The largest size up to `size` that fits `width`, cutting the text with an ellipsis when even the minimum doesn't. */
function fitLine(
  doc: PDFKit.PDFDocument,
  text: string,
  font: string,
  size: number,
  width: number,
): { text: string; size: number } {
  doc.font(font).fontSize(size);
  const natural = doc.widthOfString(text);
  if (natural <= width) return { text, size };
  const shrunk = Math.max(MIN_FONT_SIZE, (size * width) / natural);
  doc.fontSize(shrunk);
  if (doc.widthOfString(text) <= width) return { text, size: shrunk };
  let cut = text;
  while (cut.length > 0 && doc.widthOfString(`${cut.trimEnd()}${ELLIPSIS}`) > width)
    cut = cut.slice(0, -1);
  return { text: `${cut.trimEnd()}${ELLIPSIS}`, size: shrunk };
}

function drawLabel(doc: PDFKit.PDFDocument, label: LabelContent, size: LabelSize): void {
  const { width, height } = size;
  const margin = Math.min(width, height) * 0.06;
  let textX = margin;
  if (label.qr) {
    const side = Math.min(height - 2 * margin, (width - 2 * margin) * 0.5);
    drawQr(doc, label.qr, margin, (height - side) / 2, side);
    textX = margin + side + margin;
  }
  const textWidth = width - textX - margin;
  const boxHeight = height - 2 * margin;

  // Scale every line together so the block fits the label's height, then fit each line's width.
  const scale = height / REFERENCE_HEIGHT;
  const wanted = label.lines.map((line) => ({ line, size: SIZES[line.style] * scale }));
  const total = wanted.reduce((sum, w) => sum + w.size * LINE_HEIGHT, 0);
  const shrink = Math.min(1, boxHeight / total);
  const lines = wanted.map(({ line, size }) => ({
    font: FONTS[line.style],
    ...fitLine(
      doc,
      line.text,
      FONTS[line.style],
      Math.max(MIN_FONT_SIZE, size * shrink),
      textWidth,
    ),
  }));

  let y =
    margin + Math.max(0, (boxHeight - lines.reduce((sum, l) => sum + l.size * LINE_HEIGHT, 0)) / 2);
  for (const line of lines) {
    doc.font(line.font).fontSize(line.size).text(line.text, textX, y, { lineBreak: false });
    y += line.size * LINE_HEIGHT;
  }
}

/** A PDF with one page per label, each page exactly the label's size. */
export function renderLabelsPdf(labels: LabelContent[], size: LabelSize): Promise<Buffer> {
  const doc = new PDFDocument({
    size: [size.width, size.height],
    margin: 0,
    autoFirstPage: false,
    info: { Title: "Spool labels", Creator: "bambu-hando" },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  for (const label of labels) {
    doc.addPage({ size: [size.width, size.height], margin: 0 });
    drawLabel(doc, label, size);
  }
  doc.end();
  return done;
}

/**
 * Prints a PDF with CUPS' lp, asking for the label's media size so label printers feed one label per
 * page; extra options go to lp as -o. Returns lp's reply, e.g. "request id is Label-7 (1 file(s))".
 */
export async function printPdf(
  path: string,
  printer: string,
  size: LabelSize,
  options: string[],
): Promise<string> {
  const args = [
    "-d",
    printer,
    "-t",
    "bambu-hando labels",
    "-o",
    `media=${size.media}`,
    ...options.flatMap((o) => ["-o", o]),
    "--",
    path,
  ];
  try {
    const { stdout } = await promisify(execFile)("lp", args);
    return stdout.trim();
  } catch (err) {
    const { code, stderr } = err as { code?: unknown; stderr?: string };
    if (code === "ENOENT")
      throw new Error(`printing to ${printer} failed: lp not found (printing needs CUPS)`);
    throw new Error(`printing to ${printer} failed: ${stderr?.trim() || String(err)}`);
  }
}

/** CUPS destinations, printer instances included (lpstat -e); none when CUPS isn't there. */
export async function listPrinters(): Promise<string[]> {
  try {
    const { stdout } = await promisify(execFile)("lpstat", ["-e"]);
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}
