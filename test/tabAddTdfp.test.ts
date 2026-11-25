// ABOUTME: Tests for importing your 3DFilamentProfiles spools from the Add tab: the source, its list and states, ticking,
// ABOUTME: the review (records catalog first, calls counted) and the run, its commands run against the stand-in servers.

import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { connectFilamentProfiles } from "../src/filamentProfilesConnect.js";
import { configDir } from "../src/paths.js";
import { linksPath, saveLinks } from "../src/spoolLinks.js";
import { press } from "../src/tui/core/keys.js";
import type { AppMsg, Ctx } from "../src/tui/core/types.js";
import type { FormValues } from "../src/tui/core/values.js";
import { levelRows } from "../src/tui/tabs/add/catalog.js";
import { type AddModel, init, sourcesOf } from "../src/tui/tabs/add/model.js";
import { busy, commands, hints, pageBar, update } from "../src/tui/tabs/add/update.js";
import { baseFilamentDir, installBambuStudio, X1C_04 } from "./bambuStudioSetup.js";
import {
  type FilamentProfilesServer,
  serverFilament,
  serverSpool,
  startFilamentProfilesServer,
  TEST_API_KEY,
} from "./filamentProfilesServer.js";
import {
  type SpoolEaseServer,
  startSpoolEaseServer,
  TEST_SECURITY_KEY,
} from "./spooleaseServer.js";
import { ctx, Driver } from "./tabAddHarness.js";

const tab = { update };

let home: string;
let spoolease: SpoolEaseServer;
let tdfp: FilamentProfilesServer;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "bh-add-3dfp-"));
  await installBambuStudio(home);
  vi.stubEnv("HOME", home);
  vi.stubEnv("XDG_CONFIG_HOME", undefined);
  vi.stubEnv("XDG_CACHE_HOME", undefined);
  vi.stubEnv("XDG_DATA_HOME", undefined);
  spoolease = await startSpoolEaseServer();
  tdfp = await startFilamentProfilesServer();
  tdfp.quota.remaining = 900;
  tdfp.filaments = [
    serverFilament({ id: 10512, material_type: "Elite", color: "Mildewed Red", rgb: "#AD0000" }),
    serverFilament({ id: 20, brand_name: "Acme", color: "Blue", rgb: "#0000FF" }),
  ];
  tdfp.spools = [
    serverSpool({
      short_code: "izDGMo7fU",
      filament_id: 10512,
      brand: "SUNLU",
      material_type: "Elite",
      color: "Mildewed Red",
      rgb: "#AD0000",
      remaining_grams: 740,
      empty_spool_weight: 180,
    }),
    serverSpool({ short_code: "bambu1", filament_id: 30, brand: "Bambu Lab", color: "Red" }),
    serverSpool({ short_code: "linked1", filament_id: 20, brand: "Acme", color: "Blue" }),
  ];
  vi.stubEnv("FILAMENTPROFILES_API_KEY", TEST_API_KEY);
  vi.stubEnv("FILAMENTPROFILES_API_URL", tdfp.url);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await spoolease.close();
  await tdfp.close();
});

function context(values: Partial<FormValues> = {}): Ctx {
  return ctx({
    values: {
      printerPreset: X1C_04,
      skipSpoolease: false,
      host: "127.0.0.1",
      port: String(spoolease.port),
      securityKey: TEST_SECURITY_KEY,
      ...values,
    },
  });
}

function driver(c: Ctx): Driver<AddModel> {
  const [model, cmds] = init(c, { query: "" });
  return new Driver(tab, model, c, cmds);
}

const key = (name: string) => (name === "ctrl+a" ? press("a", { ctrl: true }) : press(name));
const top = (d: Driver<AddModel>) => d.model.stack.at(-1);

/** Up from the brands to the sources, onto the 3DFP row, and open it. */
function openTdfp(d: Driver<AddModel>): Driver<AddModel> {
  return d.key(key("esc"), key("end"), key("enter"));
}

async function linkOne(): Promise<void> {
  const api = await connectFilamentProfiles();
  await saveLinks(linksPath(), api.account, "127.0.0.1", [
    { spoolease: "9", tdfp: "linked1", agreed: null, tag: null, linkedAt: "2026-11-01T00:00:00Z" },
  ]);
}

const keyNotShown = (d: Driver<AddModel>) => {
  const text = JSON.stringify(d.sent) + JSON.stringify(hints(d.model, d.context));
  expect(text).not.toContain(TEST_API_KEY);
  expect(text).not.toContain(TEST_SECURITY_KEY);
};

describe("the 3DFP source", () => {
  it("is a source beside SpoolmanDB: Find still opens on the brands, esc goes up to the sources", () => {
    const d = driver(context());
    expect(top(d)?.level).toEqual({ kind: "brands" });
    d.key(key("esc"));
    expect(top(d)?.level).toEqual({ kind: "root" });
    const rows = levelRows({ kind: "root" }, sourcesOf(d.model, d.context), new Set());
    expect(rows.map((r) => r.label)).toEqual(["SpoolmanDB", "Your 3DFilamentProfiles spools"]);
    // Nothing is read before it's opened: the quota is the user's.
    expect(tdfp.requests).toHaveLength(0);
  });

  it("without a console asks for one in Settings and reads nothing", async () => {
    const d = openTdfp(driver(context({ host: "", securityKey: "" })));
    await d.settle();
    expect(top(d)?.level).toEqual({ kind: "tdfp" });
    expect(d.model.tdfp.list.state).toBe("idle");
    expect(hints(d.model, d.context)[0]).toMatchObject({ keys: "enter" });
    d.key(key("enter"));
    expect(d.of("app/switchTab")).toEqual([
      { type: "app/switchTab", tab: "settings", focus: "spoolease.host" },
    ]);
    expect(tdfp.requests).toHaveLength(0);
  });

  it("with Use SpoolEase off points at that switch", () => {
    const d = openTdfp(driver(context({ skipSpoolease: true })));
    d.key(key("enter"));
    expect(d.of("app/switchTab").at(-1)).toMatchObject({ focus: "spoolease.skip" });
  });

  it("without a 3DFP key says how to store one, and r tries again", async () => {
    vi.stubEnv("FILAMENTPROFILES_API_KEY", undefined);
    const d = openTdfp(driver(context()));
    await d.settle();
    expect(d.model.tdfp.list).toMatchObject({ state: "failed", problem: "noKey" });
    // Tests have no keyring to read: the same fix, said by where the key would come from.
    expect(d.model.tdfp.list.error).toContain("FILAMENTPROFILES_API_KEY");
    expect(tdfp.requests).toHaveLength(0);
    vi.stubEnv("FILAMENTPROFILES_API_KEY", TEST_API_KEY);
    await d.key(key("r")).settle();
    expect(d.model.tdfp.list.state).toBe("ready");
  });

  it("a list 3DFP refused is read again only on r: showing it again spends no call", async () => {
    tdfp.replies["GET /api/v1/my/spools"] = {
      status: 500,
      body: { error: { code: "x", message: "down" } },
    };
    const d = openTdfp(driver(context()));
    await d.settle();
    expect(d.model.tdfp.list).toMatchObject({ state: "failed", problem: "other" });
    const asked = tdfp.requests.length;
    await d.key(key("esc"), key("enter")).settle();
    await d.msg({ type: "app/switchTab", tab: "add" }).settle();
    expect(tdfp.requests).toHaveLength(asked);
    delete tdfp.replies["GET /api/v1/my/spools"];
    await d.key(key("r")).settle();
    expect(d.model.tdfp.list.state).toBe("ready");
  });

  it("a console that refuses the key fails with s to fix it in Settings", async () => {
    const d = openTdfp(driver(context({ securityKey: "WRONG" })));
    await d.settle();
    expect(d.model.tdfp.list).toMatchObject({ state: "failed", problem: "spoolease" });
    expect(tdfp.requests).toHaveLength(0);
    d.key(key("s"));
    expect(d.of("app/switchTab").at(-1)).toMatchObject({ tab: "settings", focus: "spoolease.key" });
  });

  it("lists the spools not linked yet, once: opening it again reads nothing", async () => {
    await linkOne();
    const d = openTdfp(driver(context()));
    expect(d.model.tdfp.list.state).toBe("loading");
    await d.settle();
    const { list } = d.model.tdfp;
    expect(list.state).toBe("ready");
    expect(list.linked).toBe(1);
    expect(list.rows.map((r) => r.spool.shortCode)).toEqual(["izDGMo7fU", "bambu1"]);
    expect(list.rows[1]?.refusal).toMatch(/Bambu Lab/);
    expect(tdfp.requests.map((r) => r.path)).toEqual(["/api/v1/my/spools"]);
    await d.key(key("esc"), key("enter")).settle();
    expect(tdfp.requests).toHaveLength(1);
    keyNotShown(d);
  });

  it("ticks importable spools only; a refused one says why", async () => {
    const d = openTdfp(driver(context()));
    await d.settle();
    d.key(key("space"));
    expect([...d.model.tdfp.selected]).toEqual(["izDGMo7fU"]);
    expect(top(d)?.cursor).toBe(1);
    d.key(key("space"));
    expect([...d.model.tdfp.selected]).toEqual(["izDGMo7fU"]);
    expect(d.model.notice).toMatch(/Bambu Lab/);
    d.key(key("ctrl+a"));
    expect([...d.model.tdfp.selected].sort()).toEqual(["izDGMo7fU", "linked1"]);
    d.key(key("ctrl+a"));
    expect(d.model.tdfp.selected.size).toBe(0);
  });

  it("is in the palette, and a deep link opens it", () => {
    const d = driver(context());
    const command = commands(d.model, d.context).find((c) => /3DFilamentProfiles/.test(c.title));
    expect(command).toBeDefined();
    d.msg(command?.msg as AppMsg);
    expect(top(d)?.level).toEqual({ kind: "tdfp" });
    const e = driver(context());
    e.msg({ type: "app/switchTab", tab: "add", focus: "3dfp" });
    expect(top(e)?.level).toEqual({ kind: "tdfp" });
  });
});

describe("importing", () => {
  it("reviews the ticked spools with no Weights page: every target, the calls it costs", async () => {
    await linkOne();
    const d = openTdfp(driver(context()));
    await d.settle();
    d.key(key("space"), key("right"));
    expect(d.model.page).toBe("review");
    expect(pageBar(d.model, d.context).find((p) => p.id === "weights")?.state).toBe("disabled");
    expect(pageBar(d.model, d.context)[0]).toMatchObject({ id: "find", badge: "1" });
    expect(d.model.tdfp.review?.state).toBe("loading");
    await d.settle();
    const review = d.model.tdfp.review;
    expect(review?.state).toBe("ready");
    expect(review?.prepared?.items.map((i) => i.profile.filamentId)).toEqual(["Pf06dde9"]);
    expect(review?.plans?.[0]).toMatchObject({ presets: 1, existingPresets: 0 });
    // The list came from the cache; the filament's record is one call, linking one more.
    expect(review).toMatchObject({ calls: 1, linkCalls: 1 });
    expect(hints(d.model, d.context).map((h) => h.keys)).toContain("a");
    keyNotShown(d);
  });

  it("enter on a spool with nothing ticked reviews that one; esc goes back to the list", async () => {
    const d = openTdfp(driver(context()));
    await d.settle();
    d.key(key("enter"));
    expect(d.model.tdfp.review?.codes).toEqual(["izDGMo7fU"]);
    d.key(key("esc"));
    expect(d.model.page).toBe("find");
    expect(top(d)?.level).toEqual({ kind: "tdfp" });
  });

  it("a applies: presets, SpoolEase filament and spool, the link and its SpoolEase ID; then reloads and finishes", async () => {
    await linkOne();
    const d = openTdfp(driver(context()));
    await d.settle();
    await d.key(key("space"), key("right")).settle();
    d.key(key("a"));
    expect(d.model.page).toBe("run");
    expect(busy(d.model)).toBe("Importing 1 spool");
    await d.settle();
    expect(d.model.tdfp.run?.state).toBe("done");
    expect(d.model.tdfp.run?.outcomes.map((o) => o.spoolId)).toEqual(["1"]);
    expect(await readdir(baseFilamentDir(home))).toEqual([
      `SUNLU PETG Elite Mildewed Red @${X1C_04}.json`,
    ]);
    expect(spoolease.customFilaments).toContain("Pf06dde9");
    expect(spoolease.spools).toHaveLength(1);
    expect(tdfp.spools[0]?.external_id).toBe("spoolease:1");
    const file = join(configDir(process.platform, home, {}), "3dfp-links.json");
    const links = JSON.parse(await readFile(file, "utf-8")).books[0].links;
    expect(links.map((l: { tdfp: string }) => l.tdfp)).toEqual(["linked1", "izDGMo7fU"]);

    const [finished] = d.of("app/runFinished");
    expect(finished?.summary).toMatchObject({ ok: true });
    expect(finished?.summary.lines.join("\n")).toContain("izDGMo7fU");
    expect(finished?.summary.exitCode).toBeUndefined();
    expect(d.of("app/load")).toEqual(
      expect.arrayContaining([
        { type: "app/load", resource: "console", force: true },
        { type: "app/load", resource: "presets", force: true },
      ]),
    );
    // The imported spool is linked now: the list drops it, and the selection is cleared.
    expect(d.model.tdfp.list.rows.map((r) => r.spool.shortCode)).toEqual(["bambu1"]);
    expect(d.model.tdfp.selected.size).toBe(0);
    expect(hints(d.model, d.context).map((h) => h.keys)).toEqual(["l", "s", "n"]);
    d.key(key("l"));
    expect(d.of("app/openLabels")).toEqual([
      { type: "app/openLabels", request: { spoolIds: ["1"], fresh: true } },
    ]);
    d.key(key("n"));
    expect(d.model.page).toBe("find");
    expect(top(d)?.level).toEqual({ kind: "tdfp" });
    keyNotShown(d);
  });

  it("toasts the outcome only when Add is hidden, and asks exit 1 when a spool failed", async () => {
    const d = openTdfp(driver(context()));
    await d.settle();
    await d.key(key("space"), key("right")).settle();
    spoolease.replies["POST /api/spools/add-edit"] = { status: 500, body: "nope" };
    d.context = { ...d.context, activeTab: "spools" };
    await d.key(key("a")).settle();
    const [finished] = d.of("app/runFinished");
    expect(finished?.summary).toMatchObject({ ok: false, exitCode: 1 });
    expect(d.of("app/toast")).toMatchObject([{ tone: "failed" }]);
    // Not imported: it stays on the list, ticked, for another try.
    expect(d.model.tdfp.list.rows.map((r) => r.spool.shortCode)).toContain("izDGMo7fU");
  });

  it("a with nothing importable says so and runs nothing", async () => {
    const d = openTdfp(driver(context()));
    await d.settle();
    d.key(key("down"), key("enter"));
    expect(d.model.page).toBe("find");
    expect(d.model.notice).toMatch(/Bambu Lab/);
  });

  it("names a printer problem on review with s to fix it", async () => {
    const d = openTdfp(driver(context({ printerPreset: "" })));
    await d.settle();
    await d.key(key("enter")).settle();
    expect(hints(d.model, d.context).map((h) => h.keys)).toContain("s");
    d.key(key("a"));
    expect(d.model.page).toBe("review");
    d.key(key("s"));
    expect(d.of("app/switchTab").at(-1)).toMatchObject({ focus: "bambu.printers" });
  });
});
