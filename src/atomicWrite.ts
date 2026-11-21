// ABOUTME: Writes a file through a temporary file and a rename, so a reader never sees half of it.
// ABOUTME: Shared by everything bambu-hando keeps on disk: presets, the quota ledger, caches and the spool links.

import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Writes through a temporary file and a rename, so a reader never sees half a file. `mode` applies when the file is
 * written (0o600 keeps it to its owner). Each write has its own temporary name: another bambu-hando process writing the
 * same file would otherwise rename a shared one away under it.
 */
export async function writeAtomic(
  path: string,
  content: string,
  options: { mode?: number } = {},
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}-${randomUUID()}.tmp`;
  await writeFile(temp, content, {
    encoding: "utf-8",
    ...(options.mode === undefined ? {} : { mode: options.mode }),
  });
  await rename(temp, path);
}
