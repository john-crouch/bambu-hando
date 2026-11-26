// ABOUTME: Tests for the registry of writes still running, which the binary waits for before it exits.
// ABOUTME: Covers the registry itself, writeAtomic registering, and the built binary finishing a write started late.

import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { writeAtomic } from "../src/atomicWrite.js";
import { trackWrite, writesSettled } from "../src/pendingWrites.js";
import { assertNoLoginKeyring } from "./keyringGuard.js";

const BIN = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
const DIST_PENDING = pathToFileURL(
  fileURLToPath(new URL("../dist/pendingWrites.js", import.meta.url)),
).href;

function later(ms: number): { promise: Promise<void>; done: () => boolean } {
  let finished = false;
  const promise = new Promise<void>((resolve) =>
    setTimeout(() => {
      finished = true;
      resolve();
    }, ms),
  );
  return { promise, done: () => finished };
}

describe("pendingWrites", () => {
  it("settles once every tracked write has finished", async () => {
    const slow = later(50);
    trackWrite(slow.promise);
    await writesSettled();
    expect(slow.done()).toBe(true);
  });

  it("hands back the write's own promise, and settles after a failed write too", async () => {
    const failing = Promise.reject(new Error("disk full"));
    await expect(trackWrite(failing)).rejects.toThrow("disk full");
    await expect(writesSettled()).resolves.toBe(true);
  });

  it("waits for writes started while it waits", async () => {
    const second = later(40);
    trackWrite(later(20).promise.then(() => void trackWrite(second.promise)));
    await writesSettled();
    expect(second.done()).toBe(true);
  });

  it("settles at once with nothing running", async () => {
    await expect(writesSettled()).resolves.toBe(true);
  });

  it("tracks writeAtomic, so a write nobody awaits still lands", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "bh-pending-")), "nested", "file.json");
    void writeAtomic(path, "kept\n");
    await writesSettled();
    expect(await readFile(path, "utf-8")).toBe("kept\n");
  });
});

describe("the binary", () => {
  it("finishes a write still running when the command returns before it exits", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bh-pending-bin-"));
    const target = join(dir, "saved.json");
    // Loaded before bin.js: starts a write that ends well after `--help` has returned.
    const preload = join(dir, "late-write.mjs");
    await writeFile(
      preload,
      [
        `import { writeFile } from "node:fs/promises";`,
        `import { trackWrite } from ${JSON.stringify(DIST_PENDING)};`,
        `trackWrite(new Promise((resolve) => setTimeout(resolve, 300)).then(() =>`,
        `  writeFile(${JSON.stringify(target)}, "saved\\n")));`,
      ].join("\n"),
    );
    const env = { PATH: process.env.PATH ?? "", HOME: dir };
    assertNoLoginKeyring(["--help"], env);
    const code = await new Promise<number>((resolve) =>
      execFile(
        process.execPath,
        ["--import", pathToFileURL(preload).href, BIN, "--help"],
        { env },
        (err) => resolve(err ? Number(err.code) : 0),
      ),
    );
    expect(code).toBe(0);
    expect(await readFile(target, "utf-8")).toBe("saved\n");
  });
});

describe("writesSettled's time limit", () => {
  it("gives up after its limit and says a write is still running, so a stuck keyring prompt can't hold the exit forever", async () => {
    let finish = () => {};
    trackWrite(new Promise<void>((resolve) => (finish = resolve)));
    expect(await writesSettled(20)).toBe(false);
    finish();
    expect(await writesSettled(1_000)).toBe(true);
  });
});
