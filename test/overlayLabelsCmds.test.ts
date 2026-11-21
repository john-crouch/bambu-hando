// ABOUTME: Tests for the labels overlay's commands: saved choices and printers, then making, printing and remembering.
// ABOUTME: Runs against the stand-in SpoolEase server, a fake lp/lpstat on PATH and a temporary config folder.

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_LABEL_SETTINGS, loadLabelSettings } from "../src/labelSettings.js";
import { parseLabelSize } from "../src/labels.js";
import { loadLabelsCmd, makeLabelsCmd } from "../src/tui/overlays/labels/cmds.js";
import { installFakeLp } from "./fakeLp.js";
import { readPdf } from "./pdf.js";
import {
  type SpoolEaseServer,
  startSpoolEaseServer,
  TEST_SECURITY_KEY,
} from "./spooleaseServer.js";
import { runCmds } from "./tabSpoolsFixtures.js";

let server: SpoolEaseServer;
let home: string;
let lpLog: string;

beforeEach(async () => {
  server = await startSpoolEaseServer();
  server.spools.push(
    {
      id: "7",
      brand: "Acme",
      material_type: "PETG",
      color_name: "Red",
      slicer_filament: "P1111111",
    },
    {
      id: "8",
      brand: "Zeta",
      material_type: "PLA",
      color_name: "Blue",
      slicer_filament: "P2222222",
    },
  );
  server.customFilaments = "P1111111,Acme PETG Red,230,250,PETG";
  home = await mkdtemp(join(tmpdir(), "bh-labels-"));
  vi.stubEnv("HOME", home);
  vi.stubEnv("XDG_CONFIG_HOME", join(home, ".config"));
  lpLog = await installFakeLp(home, ["DYMO", "Office"]);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await server.close();
});

function conn(securityKey = TEST_SECURITY_KEY) {
  return { host: "127.0.0.1", port: server.port, securityKey, https: false };
}

const SETTINGS = { ...DEFAULT_LABEL_SETTINGS, printer: "DYMO", output: "~/labels.pdf" };

function target(overrides: { output?: string; printer?: string } = {}) {
  return {
    fields: SETTINGS.fields,
    size: parseLabelSize(SETTINGS.size),
    output: join(home, "labels.pdf"),
    printer: "DYMO",
    printOptions: [],
    ...overrides,
  };
}

describe("loadLabelsCmd", () => {
  it("reads the defaults and the printers lpstat lists", async () => {
    expect(await runCmds([loadLabelsCmd()])).toEqual([
      {
        type: "overlay",
        msg: {
          type: "labels/loaded",
          settings: DEFAULT_LABEL_SETTINGS,
          printers: ["DYMO", "Office"],
        },
      },
    ]);
  });

  it("reads the choices remembered last time", async () => {
    const config = join(home, ".config", "bambu-hando");
    await runCmds([makeLabelsCmd(conn(), ["7"], target(), SETTINGS)]);
    expect(await loadLabelSettings(join(config, "labels.json"))).toEqual(SETTINGS);
    const [loaded] = await runCmds([loadLabelsCmd()]);
    expect(loaded).toMatchObject({ msg: { settings: SETTINGS } });
  });
});

describe("makeLabelsCmd", () => {
  it("writes the PDF, prints it, remembers the choices and reports a clean run", async () => {
    const msgs = await runCmds([makeLabelsCmd(conn(), ["8", "7"], target(), SETTINGS)]);
    expect(msgs).toEqual([
      { type: "app/toast", text: "2 labels sent to DYMO and saved to labels.pdf", tone: "ok" },
      {
        type: "app/runFinished",
        summary: {
          ok: true,
          lines: [
            `Wrote 2 labels to ${join(home, "labels.pdf")}`,
            "Sent 2 labels to DYMO: request id is Label-7 (1 file(s))",
          ],
        },
      },
      { type: "overlay", msg: { type: "labels/made" } },
    ]);
    const pages = readPdf(await readFile(join(home, "labels.pdf")));
    expect(pages).toHaveLength(2);
    expect(pages[0]?.texts.map((t) => t.text)).toContain("Zeta");
    expect(await readFile(join(lpLog, "args"), "utf-8")).toContain("DYMO");
    expect(JSON.stringify(msgs)).not.toContain(TEST_SECURITY_KEY);
  });

  it("only prints when no PDF path is given", async () => {
    const msgs = await runCmds([makeLabelsCmd(conn(), ["7"], target({ output: "" }), SETTINGS)]);
    expect(msgs[0]).toEqual({ type: "app/toast", text: "1 label sent to DYMO", tone: "ok" });
  });

  it("counts a failed print as a failed run, keeping the PDF and the choices", async () => {
    vi.stubEnv("LP_FAIL", "printer is offline");
    const msgs = await runCmds([makeLabelsCmd(conn(), ["7"], target(), SETTINGS)]);
    expect(msgs[0]).toMatchObject({ type: "app/toast", tone: "failed" });
    expect(msgs[1]).toEqual({
      type: "app/runFinished",
      summary: {
        ok: false,
        lines: [
          `Wrote 1 label to ${join(home, "labels.pdf")}`,
          "printing to DYMO failed: lp: printer is offline",
        ],
        exitCode: 1,
      },
    });
    await expect(readFile(join(home, "labels.pdf"))).resolves.toBeInstanceOf(Buffer);
    expect(await loadLabelSettings(join(home, ".config", "bambu-hando", "labels.json"))).toEqual(
      SETTINGS,
    );
  });

  it("reports a spool the console doesn't have", async () => {
    const msgs = await runCmds([makeLabelsCmd(conn(), ["99"], target(), SETTINGS)]);
    expect(msgs[1]).toEqual({
      type: "app/runFinished",
      summary: {
        ok: false,
        lines: ["Labels failed: SpoolEase has no spool with ID 99"],
        exitCode: 1,
      },
    });
  });

  it("reports a rejected key as a setup error, still remembering the choices", async () => {
    const msgs = await runCmds([makeLabelsCmd(conn("WRONG"), ["7"], target(), SETTINGS)]);
    expect(msgs[1]).toEqual({
      type: "app/runFinished",
      summary: {
        ok: false,
        lines: ["Labels failed: SpoolEase key validation failed"],
        exitCode: 2,
      },
    });
    expect(msgs[2]).toEqual({ type: "overlay", msg: { type: "labels/made" } });
    expect(server.requests.filter((r) => r.path === "/api/spools")).toEqual([]);
    expect(await loadLabelSettings(join(home, ".config", "bambu-hando", "labels.json"))).toEqual(
      SETTINGS,
    );
  });

  it("says so when the choices can't be remembered, without failing the run", async () => {
    await writeFile(join(home, ".config"), "a file where the folder should be");
    const msgs = await runCmds([makeLabelsCmd(conn(), ["7"], target({ output: "" }), SETTINGS)]);
    expect(msgs[1]).toMatchObject({
      summary: {
        ok: true,
        lines: [
          expect.any(String),
          expect.stringMatching(/^Couldn't remember these label choices: /),
        ],
      },
    });
  });
});
