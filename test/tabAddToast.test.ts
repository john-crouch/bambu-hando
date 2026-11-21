// ABOUTME: Tests for Add's run toast: none while Add is on screen (its Done or Failed card says it), one when it's hidden.
// ABOUTME: Drives a run to its end with pure updates and collects what the commands send.

import { describe, expect, it } from "vitest";

import type { SyncResult } from "../src/models.js";
import { press } from "../src/tui/core/keys.js";
import type { AppMsg, Ctx, TabId, TabMsg } from "../src/tui/core/types.js";
import { addTab } from "../src/tui/tabs/add/index.js";
import type { AddModel } from "../src/tui/tabs/add/model.js";
import { ctx } from "./tabAddHarness.js";

function running(c: Ctx): AddModel {
  let [model] = addTab.init(c, { query: "" });
  for (const key of ["enter", "down", "enter", "space", "right"])
    [model] = addTab.update(model, { type: "key", key: press(key) }, c);
  [model] = addTab.update(
    model,
    {
      type: "add/planRead",
      seq: model.review.seq,
      plans: [
        {
          presets: 1,
          existingPresets: 0,
          nozzleRange: { low: 200, high: 220 },
          filament: null,
          spool: null,
        },
      ],
      warnings: [],
    },
    c,
  );
  [model] = addTab.update(model, { type: "key", key: press("a") }, c);
  expect(model.run?.state).toBe("running");
  return model;
}

async function finish(msg: TabMsg, activeTab?: TabId): Promise<AppMsg[]> {
  const c: Ctx = { ...ctx(), ...(activeTab ? { activeTab } : {}) };
  const [, cmds] = addTab.update(running(c), msg, c);
  const out: AppMsg[] = [];
  for (const cmd of cmds) await cmd((m) => out.push(m));
  return out;
}

const result: SyncResult = {
  profileName: "Acme PLA Blue",
  filamentId: "PACMBLU0",
  bambuStatus: "written",
  spooleaseStatus: "skipped",
  detail: "",
  coreWeight: 200,
  spoolId: "",
};
const done = { type: "add/runDone", results: [result] };
const failed = {
  type: "add/runFailed",
  error: "BambuStudio's system profiles are missing",
  exitCode: 2,
};

describe("the run's toast", () => {
  it("isn't sent while Add is on screen: the Done or Failed card says it", async () => {
    for (const msg of [done, failed]) {
      const sent = await finish(msg, "add");
      expect(sent.filter((m) => m.type === "app/toast")).toEqual([]);
      expect(sent.some((m) => m.type === "app/runFinished")).toBe(true);
    }
  });

  it("is sent when the run ends while another tab is shown", async () => {
    expect((await finish(done, "spools")).filter((m) => m.type === "app/toast")).toEqual([
      { type: "app/toast", text: "1 filament added", tone: "ok" },
    ]);
    expect((await finish(failed, "check")).filter((m) => m.type === "app/toast")).toHaveLength(1);
  });

  it("is sent when the shell doesn't say which tab is shown", async () => {
    expect((await finish(done)).filter((m) => m.type === "app/toast")).toHaveLength(1);
  });
});
