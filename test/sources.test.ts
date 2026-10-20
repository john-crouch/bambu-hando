// ABOUTME: Tests profile source ingestion and normalization from files and URLs.
// ABOUTME: Ensures imported data maps to the same normalized profiles as the Python original.

import { createServer, type Server } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadProfiles } from "../src/sources.js";
import { parityProfiles, SOURCE_FIXTURE } from "./parity.js";

async function writeSource(content: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bambu-hando-sources-"));
  const path = join(dir, "profiles.json");
  await writeFile(path, JSON.stringify(content), "utf-8");
  return path;
}

describe("loadProfiles", () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  it("normalizes the reference source exactly like the Python implementation", async () => {
    expect(await loadProfiles(SOURCE_FIXTURE)).toEqual(parityProfiles);
  });

  it("accepts a bare JSON list", async () => {
    const path = await writeSource([{ name: "PLA Blue", color_name: "blue" }]);
    const [profile] = await loadProfiles(path);
    expect(profile?.colorRgba).toBe("0000FFFF");
  });

  it("downloads sources over HTTP", async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([{ name: "Remote PETG", material: "petg" }]));
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    const [profile] = await loadProfiles(`http://127.0.0.1:${port}/profiles.json`);
    expect(profile?.material).toBe("PETG");
  });

  it("fails on HTTP error responses", async () => {
    server = createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    await expect(loadProfiles(`http://127.0.0.1:${port}/missing.json`)).rejects.toThrow("HTTP 404");
  });

  it("rejects entries without a name", async () => {
    const path = await writeSource([{ brand: "Nameless" }]);
    await expect(loadProfiles(path)).rejects.toThrow("Profile entry at index 0 is missing name");
  });

  it("rejects non-object entries", async () => {
    const path = await writeSource(["PLA"]);
    await expect(loadProfiles(path)).rejects.toThrow("Profile entry at index 0 is not an object");
  });

  it("rejects unsupported top-level shapes", async () => {
    const path = await writeSource("profiles");
    await expect(loadProfiles(path)).rejects.toThrow("Unsupported profile source shape");
  });

  it("rejects non-integer temperatures", async () => {
    const path = await writeSource([{ name: "Hot", nozzle_temp_max: "hot" }]);
    await expect(loadProfiles(path)).rejects.toThrow("Profile entry at index 0 has invalid nozzle_temp_max");
  });
});
