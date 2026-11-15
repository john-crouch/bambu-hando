// ABOUTME: Tests for giving BambuStudio presets without a filament ID the one BambuStudio would have made.
// ABOUTME: Writes real preset and .info files in a temporary folder and reads them back.

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { fixPresetIds, idFixes } from "../src/presetIds.js";
import { derivedFilamentId } from "../src/sources.js";

describe("idFixes", () => {
  it("gives each preset without an ID the one derived from its filament name, the same for every printer", () => {
    const presets = [
      { name: "Rock", filamentId: "", printer: "X1", path: "/p/Rock @X1.json" },
      { name: "Rock", filamentId: "", printer: "X1C", path: "/p/Rock @X1C.json" },
      { name: "Red", filamentId: "PA000001", printer: "X1", path: "/p/Red @X1.json" },
    ];
    expect(idFixes(presets)).toEqual([
      { path: "/p/Rock @X1.json", name: "Rock", printer: "X1", id: derivedFilamentId("Rock") },
      { path: "/p/Rock @X1C.json", name: "Rock", printer: "X1C", id: derivedFilamentId("Rock") },
    ]);
  });
});

describe("fixPresetIds", () => {
  let dir: string;
  const NOW = 1_800_000_000_000;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bambu-hando-ids-"));
  });

  // As BambuStudio writes them: 4-space indent, a newline at the end, keys in its order.
  async function preset(file: string, filamentId: string | undefined): Promise<string> {
    const path = join(dir, file);
    const json = { zeta: ["1"], inherits: "", ...(filamentId === undefined ? {} : { filament_id: filamentId }), name: file.slice(0, -5), alpha: ["2"] };
    await writeFile(path, `${JSON.stringify(json, null, 4)}\n`);
    return path;
  }

  it("writes the ID into the preset, changing nothing else, and dates its .info so BambuStudio uploads it", async () => {
    const path = await preset("Rock @X1.json", "null");
    await writeFile(join(dir, "Rock @X1.info"), "sync_info = \nuser_id = 1234\nsetting_id = PFUS0000\nbase_id = \nupdated_time = 1700000000\n");

    const results = await fixPresetIds([{ path, name: "Rock", printer: "X1", id: "P1234567" }], NOW);

    expect(results).toEqual([{ path, name: "Rock", printer: "X1", id: "P1234567", ok: true, detail: "" }]);
    const written = await readFile(path, "utf-8");
    expect(written).toBe(`${JSON.stringify({ zeta: ["1"], inherits: "", filament_id: "P1234567", name: "Rock @X1", alpha: ["2"] }, null, 4)}\n`);
    expect(await readFile(join(dir, "Rock @X1.info"), "utf-8")).toBe("sync_info = \nuser_id = 1234\nsetting_id = PFUS0000\nbase_id = \nupdated_time = 1800000000\n");
  });

  it("adds a missing filament_id, and needs no .info", async () => {
    const path = await preset("Own @X1.json", undefined);

    const [result] = await fixPresetIds([{ path, name: "Own", printer: "X1", id: "P7654321" }], NOW);

    expect(result).toMatchObject({ ok: true });
    expect(JSON.parse(await readFile(path, "utf-8")).filament_id).toBe("P7654321");
  });

  it("leaves a preset that has an ID by now, and reports one it can't read", async () => {
    const path = await preset("Rock @X1.json", "PA000001");
    const before = await readFile(path, "utf-8");
    await writeFile(join(dir, "broken.json"), "{");

    const results = await fixPresetIds(
      [
        { path, name: "Rock", printer: "X1", id: "P1234567" },
        { path: join(dir, "broken.json"), name: "broken", printer: "", id: "P1111111" },
      ],
      NOW,
    );

    expect(results[0]).toMatchObject({ ok: false, detail: "it has filament ID PA000001 now; left as it is" });
    expect(await readFile(path, "utf-8")).toBe(before);
    expect(results[1]).toMatchObject({ ok: false, detail: expect.stringMatching(/^couldn't read it: /) });
  });
});
