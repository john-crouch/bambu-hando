// ABOUTME: Tests for Find's detail of the highlighted color: what adding it does, read as Review reads it, never promised.
// ABOUTME: Presets on disk and the stand-in console decide each line; the console is read once per settings.

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildCustomFilamentsCsv } from "../src/spoolease.js";
import { press } from "../src/tui/core/keys.js";
import type { Ctx } from "../src/tui/core/types.js";
import type { FormValues } from "../src/tui/core/values.js";
import { type AddModel, init } from "../src/tui/tabs/add/model.js";
import { findDetailOf } from "../src/tui/tabs/add/peek.js";
import { update } from "../src/tui/tabs/add/update.js";
import { baseFilamentDir, installBambuStudio, X1C_04, X1C_06 } from "./bambuStudioSetup.js";
import {
  type SpoolEaseServer,
  startSpoolEaseServer,
  TEST_SECURITY_KEY,
} from "./spooleaseServer.js";
import { ctx, Driver, fixtureCatalog } from "./tabAddHarness.js";

const tab = { update };

let home: string;
let server: SpoolEaseServer;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "bh-peek-"));
  await installBambuStudio(home);
  vi.stubEnv("HOME", home);
  vi.stubEnv("XDG_CONFIG_HOME", join(home, ".config"));
  server = await startSpoolEaseServer();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await server.close();
});

const POLYLITE_NAME = "Polymaker PolyLite™ PETG Black";
const POLYLITE = "Peddfd02";

function context(values: Partial<FormValues> = {}): Ctx {
  return ctx({
    values: {
      printerPreset: X1C_04,
      skipSpoolease: false,
      host: "127.0.0.1",
      port: String(server.port),
      securityKey: TEST_SECURITY_KEY,
      ...values,
    },
    resources: { catalog: { state: "ready", value: fixtureCatalog(), at: 0 } },
  });
}

function start(values: Partial<FormValues> = {}): Driver<AddModel> {
  const c = context(values);
  const [model, cmds] = init(c, { query: "" });
  return new Driver(tab, model, c, cmds);
}

/** Search highlights the first match: the detail is that color's. */
function highlight(d: Driver<AddModel>, words: string): Driver<AddModel> {
  return d.key(press("/"), press(words), press("down"));
}

function adds(d: Driver<AddModel>): string[] | null {
  const detail = findDetailOf(d.model, d.context);
  if (detail?.kind !== "color") throw new Error(`not a color: ${detail?.kind}`);
  return detail.adds?.map((line) => `${line.mark} ${line.text}`) ?? null;
}

async function keepPolyLite(): Promise<void> {
  const dir = baseFilamentDir(home);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${POLYLITE_NAME} @${X1C_04}.json`),
    `${JSON.stringify({ filament_id: POLYLITE, inherits: "" })}\n`,
  );
}

function polyLiteProfile() {
  const found = fixtureCatalog().profiles.find((p) => p.filamentId === POLYLITE);
  if (!found) throw new Error("PolyLite missing from the fixture");
  return found;
}

describe("Find's color detail", () => {
  it("says what adding a filament nothing has yet writes, in lowercase after the mark", async () => {
    const d = highlight(start(), "polylite");
    await d.settle();
    expect(adds(d)).toEqual([
      "+ a BambuStudio preset for X1C 0.4",
      "+ a SpoolEase custom filament",
      "+ a SpoolEase spool",
    ]);
  });

  it("never promises a preset, row or spool that's there already", async () => {
    await keepPolyLite();
    server.customFilaments = buildCustomFilamentsCsv([polyLiteProfile()]);
    server.spools = [{ id: "1", slicer_filament: POLYLITE, brand: "Polymaker" }];
    const d = highlight(start(), "polylite");
    await d.settle();
    expect(adds(d)).toEqual([
      "= BambuStudio preset for X1C 0.4: kept",
      "= on SpoolEase's custom filaments already",
      "= a SpoolEase spool is there: no new one",
    ]);
  });

  it("says checking until it knows, instead of promising", () => {
    const d = highlight(start(), "polylite");
    expect(adds(d)).toBeNull();
  });

  it("says replaced when overwriting, and counts printers that have one", async () => {
    await keepPolyLite();
    const over = highlight(start({ overwritePresets: true }), "polylite");
    await over.settle();
    expect(adds(over)?.[0]).toBe("↻ BambuStudio preset for X1C 0.4: replaced");
    const two = highlight(start({ printerPreset: `${X1C_04},${X1C_06}` }), "polylite");
    await two.settle();
    expect(adds(two)?.[0]).toBe("+ 1 new BambuStudio preset; 1 kept");
  });

  it("says SpoolEase is checked on Review when the console can't be read", async () => {
    server.replies["/api/filaments-config"] = { status: 500, body: "boom", plain: true };
    const d = highlight(start(), "polylite");
    await d.settle();
    expect(adds(d)).toEqual([
      "+ a BambuStudio preset for X1C 0.4",
      "? SpoolEase: couldn't read it, Review checks again",
    ]);
  });

  it("leaves SpoolEase out when it's skipped", async () => {
    const d = highlight(start({ skipSpoolease: true }), "polylite");
    await d.settle();
    expect(adds(d)).toEqual(["+ a BambuStudio preset for X1C 0.4"]);
  });

  it("reads the console once for several highlighted colors, and again when settings change", async () => {
    const d = start();
    await d.key(press("/"), press("black"), press("down")).settle();
    await d.key(press("down")).settle();
    await d.key(press("down")).settle();
    const reads = () => server.requests.filter((r) => r.path === "/api/filaments-config").length;
    expect(reads()).toBe(1);
    expect(adds(d)).not.toBeNull();
    d.context = context({ createSpools: false });
    await d.key(press("up")).settle();
    expect(reads()).toBe(2);
    expect(adds(d)?.some((line) => line.includes("spool"))).toBe(false);
  });

  it("reads presets again after BambuStudio's presets reload", async () => {
    const d = highlight(start({ skipSpoolease: true }), "polylite");
    await d.settle();
    expect(adds(d)?.[0]).toMatch(/^\+/);
    await keepPolyLite();
    await d.msg({ type: "app/loaded", resource: "presets", result: { state: "idle" } }).settle();
    expect(adds(d)?.[0]).toMatch(/^= /);
  });
});
