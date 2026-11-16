// ABOUTME: Tests for writing files through a temporary file and a rename, so readers never see half a file.
// ABOUTME: Covers concurrent writers to one path, the file mode, and creating missing folders.

import { mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { writeAtomic } from "../src/atomicWrite.js";

describe("writeAtomic", () => {
  it("creates missing folders and leaves no temporary file behind", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bh-atomic-"));
    const path = join(dir, "nested", "file.json");
    await writeAtomic(path, "one\n");
    expect(await readFile(path, "utf-8")).toBe("one\n");
    expect(await readdir(join(dir, "nested"))).toEqual(["file.json"]);
  });

  it("never fails when other processes write the same file at once", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "bh-atomic-")), "file.json");
    const contents = Array.from({ length: 50 }, (_, i) => `write ${i}\n`);
    const results = await Promise.allSettled(contents.map((content) => writeAtomic(path, content)));
    expect(results.filter((result) => result.status === "rejected")).toEqual([]);
    expect(contents).toContain(await readFile(path, "utf-8"));
  });

  it("creates the file with the mode asked for", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "bh-atomic-")), "secret.json");
    await writeAtomic(path, "{}\n", { mode: 0o600 });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });
});
