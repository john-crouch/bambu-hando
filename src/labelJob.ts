// ABOUTME: Makes spool labels end to end: reads spools from SpoolEase, picks some, writes and/or prints the PDF.
// ABOUTME: Shared by the labels command, labels after a sync, and the TUI.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { errorMessage } from "./errors.js";
import { printPdf, renderLabelsPdf } from "./labelPdf.js";
import { filterSpools, type LabelField, type LabelSize, labelContent, type SpoolFilters } from "./labels.js";
import type { CustomFilament, SpoolEaseClient, SpoolRecord } from "./spoolease.js";

/** The filters matched no spool, or named one SpoolEase doesn't have. */
export class LabelSelectionError extends Error {
  override name = "LabelSelectionError";
}

export interface LabelTarget {
  fields: LabelField[];
  size: LabelSize;
  /** PDF path; empty to only print. */
  output: string;
  /** CUPS destination; empty to only write the PDF. */
  printer: string;
  printOptions: string[];
}

export interface LabelsMade {
  spools: SpoolRecord[];
  /** lp's reply when printed. */
  printReply: string;
  /** Why printing failed; the PDF is still written when an output path was given. */
  printError: string;
}

export async function makeLabels(
  client: SpoolEaseClient,
  filters: SpoolFilters,
  target: LabelTarget,
  warn: (message: string) => void = () => {},
): Promise<LabelsMade> {
  const spools = await client.listSpools();
  let filaments = new Map<string, CustomFilament>();
  try {
    filaments = await client.getCustomFilaments();
  } catch (err) {
    warn(`Couldn't read custom filaments from SpoolEase, so labels show no filament names or temperatures: ${errorMessage(err)}`);
  }

  let chosen: SpoolRecord[];
  try {
    chosen = filterSpools(spools, filaments, filters);
  } catch (err) {
    throw new LabelSelectionError(errorMessage(err));
  }
  if (chosen.length === 0) throw new LabelSelectionError("no SpoolEase spools match the filters");

  const pdf = await renderLabelsPdf(
    chosen.map((spool) => labelContent(spool, filaments, target.fields)),
    target.size,
  );
  if (target.output) await writeFile(target.output, pdf);

  const made: LabelsMade = { spools: chosen, printReply: "", printError: "" };
  if (target.printer) {
    const tmp = target.output ? "" : await mkdtemp(join(tmpdir(), "bambu-hando-labels-"));
    try {
      const path = target.output || join(tmp, "labels.pdf");
      if (tmp) await writeFile(path, pdf);
      made.printReply = await printPdf(path, target.printer, target.size, target.printOptions);
    } catch (err) {
      made.printError = errorMessage(err);
    } finally {
      if (tmp) await rm(tmp, { recursive: true, force: true });
    }
  }
  return made;
}
