// ABOUTME: The local file linking SpoolEase spools to 3DFilamentProfiles spools, the sync's source of truth.
// ABOUTME: One book of links per 3DFP account and SpoolEase console, each with the weights both sides last agreed on.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { configDir, tildePath } from "./paths.js";

export interface SpoolLink {
  /** The SpoolEase spool's id. */
  spoolease: string;
  /** The 3DFilamentProfiles spool's short code. */
  tdfp: string;
  /** Filament left on each side (grams) the last time they agreed; null until they have. */
  agreed: { spoolease: number; tdfp: number } | null;
  /** The SpoolEase tag UID last written to the 3DFP spool's bambu_tag_id; null when none was. */
  tag: string | null;
  /** ISO 8601. */
  linkedAt: string;
}

interface LinkBook {
  /** accountId of the 3DFP key. */
  account: string;
  /** The SpoolEase console's host. */
  console: string;
  links: SpoolLink[];
}

export function linksPath(): string {
  return join(configDir(), "3dfp-links.json");
}

const isGrams = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function parseLink(raw: unknown): SpoolLink | null {
  if (typeof raw !== "object" || raw === null) return null;
  const link = raw as Record<string, unknown>;
  if (typeof link.spoolease !== "string" || typeof link.tdfp !== "string") return null;
  const agreed = link.agreed as Record<string, unknown> | null | undefined;
  return {
    spoolease: link.spoolease,
    tdfp: link.tdfp,
    agreed: agreed && isGrams(agreed.spoolease) && isGrams(agreed.tdfp) ? { spoolease: agreed.spoolease, tdfp: agreed.tdfp } : null,
    tag: typeof link.tag === "string" && link.tag ? link.tag : null,
    linkedAt: typeof link.linkedAt === "string" ? link.linkedAt : "",
  };
}

/** The file's books: none when there's no file; null when it can't be opened or parsed. */
async function readBooks(path: string): Promise<LinkBook[] | null> {
  let text: string;
  try {
    text = await readFile(path, "utf-8");
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT" ? [] : null;
  }
  try {
    const saved = JSON.parse(text) as { books?: unknown };
    if (!Array.isArray(saved.books)) return null;
    return saved.books
      .filter((book): book is Record<string, unknown> => typeof book === "object" && book !== null)
      .filter((book) => typeof book.account === "string" && typeof book.console === "string")
      .map((book) => ({
        account: String(book.account),
        console: String(book.console),
        links: (Array.isArray(book.links) ? book.links : []).map(parseLink).filter((link): link is SpoolLink => link !== null),
      }));
  } catch {
    return null;
  }
}

/** The links of one 3DFP account and SpoolEase console; a damaged file reads as none, with a warning. */
export async function loadLinks(path: string, account: string, console: string): Promise<{ links: SpoolLink[]; warning: string | null }> {
  const books = await readBooks(path);
  if (books === null) return { links: [], warning: `the spool link file ${tildePath(path)} can't be read: starting with no links; it will be set aside, not overwritten` };
  return { links: books.find((book) => book.account === account && book.console === console)?.links ?? [], warning: null };
}

/**
 * Replaces one account and console's links, keeping every other book in the file.
 * A file that can't be read is renamed aside first, since it may hold other books; returns that copy's path, else null.
 */
export async function saveLinks(path: string, account: string, console: string, links: SpoolLink[]): Promise<string | null> {
  const read = await readBooks(path);
  let setAside: string | null = null;
  if (read === null) {
    setAside = `${path}.damaged-${new Date().toISOString().replaceAll(":", "-")}`;
    await rename(path, setAside);
  }
  const others = (read ?? []).filter((book) => book.account !== account || book.console !== console);
  const books = [...others, { account, console, links }];
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, `${JSON.stringify({ version: 1, books }, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
  await rename(`${path}.tmp`, path);
  return setAside;
}
