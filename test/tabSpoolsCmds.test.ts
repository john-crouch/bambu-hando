// ABOUTME: Tests for the Spools tab's commands against the stand-in SpoolEase server and a temporary config folder.
// ABOUTME: Also runs whole flows (scan → learn → count → add → labels) through a Program, the way the shell routes them.

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadBarcodes } from "../src/barcodes.js";
import { press } from "../src/tui/core/keys.js";
import { Program } from "../src/tui/core/program.js";
import type { AppMsg, Ctx } from "../src/tui/core/types.js";
import { addCopiesCmd, loadBarcodesCmd, rememberBarcodeCmd } from "../src/tui/tabs/spools/cmds.js";
import { init, type SpoolsModel, update } from "../src/tui/tabs/spools/model.js";
import {
  type SpoolEaseServer,
  startSpoolEaseServer,
  TEST_SECURITY_KEY,
} from "./spooleaseServer.js";
import { consoleOf, makeCtx, runCmds, spool } from "./tabSpoolsFixtures.js";

const FILAMENT = {
  code: "P2222222",
  name: "Zeta PLA Blue",
  count: 1,
  spool: spool({ id: "2", slicerFilament: "P2222222" }),
};

let server: SpoolEaseServer;
let config: string;

beforeEach(async () => {
  server = await startSpoolEaseServer();
  config = await mkdtemp(join(tmpdir(), "bh-spools-"));
  vi.stubEnv("XDG_CONFIG_HOME", config);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await server.close();
});

function conn(securityKey = TEST_SECURITY_KEY) {
  return { host: "127.0.0.1", port: server.port, securityKey, https: false };
}

function serverCtx(overrides: Partial<Ctx> = {}): Ctx {
  return {
    ...makeCtx({
      values: { port: String(server.port), securityKey: TEST_SECURITY_KEY },
      resources: {
        console: consoleOf([
          spool({ id: "1" }),
          spool({
            id: "2",
            slicerFilament: "P2222222",
            brand: "Zeta",
            material: "PLA",
            colorName: "Blue",
          }),
        ]),
      },
    }),
    ...overrides,
  };
}

const tabMsgs = (msgs: AppMsg[]) => msgs.map((m) => (m.type === "tab" ? m.msg : m));

describe("addCopiesCmd", () => {
  it("adds the copies one by one and reports each, then all", async () => {
    const msgs = tabMsgs(await runCmds([addCopiesCmd(conn(), FILAMENT, 2, 4)]));
    expect(msgs).toEqual([
      { type: "spools/copy", run: 4, result: { ok: true, id: "1" } },
      { type: "spools/copy", run: 4, result: { ok: true, id: "2" } },
      {
        type: "spools/copiesDone",
        run: 4,
        results: [
          { ok: true, id: "1" },
          { ok: true, id: "2" },
        ],
        error: "",
      },
    ]);
    expect(server.spools.map((s) => s.slicer_filament)).toEqual(["P2222222", "P2222222"]);
  });

  it("sends nothing with a rejected key and reports a setup error", async () => {
    const msgs = tabMsgs(await runCmds([addCopiesCmd(conn("WRONG"), FILAMENT, 2, 1)]));
    expect(msgs).toEqual([
      {
        type: "spools/copiesDone",
        run: 1,
        results: [],
        error: "SpoolEase key validation failed",
        exitCode: 2,
      },
    ]);
    expect(server.requests.filter((r) => r.path === "/api/spools/add-edit")).toEqual([]);
  });

  it("reports an unreachable console as a setup error", async () => {
    await server.close();
    const msgs = tabMsgs(await runCmds([addCopiesCmd(conn(), FILAMENT, 1, 1)]));
    expect(msgs).toMatchObject([{ type: "spools/copiesDone", results: [], exitCode: 2 }]);
    server = await startSpoolEaseServer();
  });
});

describe("barcode commands", () => {
  it("reads no barcodes from a missing file, then the ones remembered", async () => {
    expect(tabMsgs(await runCmds([loadBarcodesCmd()]))).toEqual([
      { type: "spools/barcodes", barcodes: new Map() },
    ]);
    const filament = { code: "P2222222", name: "Zeta PLA Blue" };
    expect(tabMsgs(await runCmds([rememberBarcodeCmd("0015", filament)]))).toEqual([
      { type: "spools/remembered", barcode: "0015", filament },
    ]);
    expect(await loadBarcodes(join(config, "bambu-hando", "barcodes.json"))).toEqual(
      new Map([["0015", filament]]),
    );
  });

  it("reports a barcode it couldn't save", async () => {
    await writeFile(join(config, "bambu-hando"), "a file where the folder should be");
    const msgs = tabMsgs(await runCmds([rememberBarcodeCmd("0015", { code: "P1", name: "x" })]));
    expect(msgs).toMatchObject([{ type: "spools/rememberFailed", barcode: "0015" }]);
  });
});

/** The tab in a Program, routed like the shell: tab messages to update, app messages recorded. */
function program(ctx: Ctx) {
  const app: AppMsg[] = [];
  const errors: unknown[] = [];
  const prog = new Program<SpoolsModel, AppMsg>(
    init(ctx, { query: "" }),
    (model, msg) => {
      if (msg.type === "tab") return update(model, msg.msg, ctx);
      if (msg.type === "key") return update(model, msg, ctx);
      app.push(msg);
      return [model, []];
    },
    (err) => {
      errors.push(err);
      return { type: "app/error", error: String(err) };
    },
  );
  const keys = (...what: string[]) => {
    for (const k of what) prog.dispatch({ type: "key", key: press(k) });
  };
  return { prog, app, errors, keys };
}

describe("flows", () => {
  it("adds two spools like the highlighted one and offers their labels", async () => {
    const { prog, app, errors, keys } = program(serverCtx());
    keys("+", "up", "a");
    await vi.waitFor(() => expect(prog.model.dialog).toMatchObject({ phase: "done" }));
    expect(prog.model.dialog).toMatchObject({
      results: [
        { ok: true, id: "1" },
        { ok: true, id: "2" },
      ],
    });
    await vi.waitFor(() =>
      expect(app).toContainEqual({
        type: "app/runFinished",
        summary: {
          ok: true,
          lines: [`2 spools of Zeta PLA Blue added to http://127.0.0.1:${server.port}: #1, #2`],
        },
      }),
    );
    keys("l");
    await vi.waitFor(() =>
      expect(app).toContainEqual({
        type: "app/openLabels",
        request: { spoolIds: ["1", "2"], fresh: true },
      }),
    );
    expect(errors).toEqual([]);
    // The key never travels in a message.
    expect(JSON.stringify(app)).not.toContain(TEST_SECURITY_KEY);
  });

  it("learns a new barcode, then goes straight to the count next time", async () => {
    const first = program(serverCtx());
    first.keys("b");
    await vi.waitFor(() => expect(first.prog.model.barcodes).not.toBeNull());
    first.keys("4006381333931\r", "z", "enter");
    await vi.waitFor(() => expect(first.prog.model.dialog).toMatchObject({ kind: "count" }));
    expect(first.prog.model.dialog).toMatchObject({ filament: { code: "P2222222" } });

    const second = program(serverCtx());
    second.keys("b", "4006381333931\r");
    await vi.waitFor(() =>
      expect(second.prog.model.dialog).toMatchObject({
        kind: "known",
        filament: { code: "P2222222" },
      }),
    );
    second.keys("enter", "a");
    await vi.waitFor(() => expect(second.prog.model.dialog).toMatchObject({ phase: "done" }));
    expect(server.spools).toHaveLength(1);
    expect(second.errors).toEqual([]);
  });
});
