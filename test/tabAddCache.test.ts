// ABOUTME: Tests that Add's cached reads follow what they were read for: Weights per profile, Review per setting.
// ABOUTME: Switching the import, reloading SpoolmanDB or changing diameter and source in Settings must never bring back old profiles.

import { describe, expect, it } from "vitest";

import type { FilamentProfile } from "../src/models.js";
import { parseSpoolWeightList } from "../src/spoolWeights.js";
import { press } from "../src/tui/core/keys.js";
import type { AppMsg, Ctx, TabMsg } from "../src/tui/core/types.js";
import type { FormValues } from "../src/tui/core/values.js";
import { addTab } from "../src/tui/tabs/add/index.js";
import type { AddModel } from "../src/tui/tabs/add/model.js";
import { planBasis, sameBasis } from "../src/tui/tabs/add/targets.js";
import { catalog, ctx, PROFILES, profile, values } from "./tabAddHarness.js";

const CONSOLE: Partial<FormValues> = {
  skipSpoolease: false,
  host: "10.0.0.5",
  securityKey: "SECRET",
  createSpools: true,
};

/** One catalog row per brand, so no brand is asked about and Weights goes straight on to Review. */
const ENTRIES = parseSpoolWeightList(
  "Acme - Plastic - 220g,220\r\nZed - Plastic - 180g,180\r\nSunlu - Plastic - 150g,150",
);

function step(model: AddModel, msg: AppMsg | TabMsg, c: Ctx): AddModel {
  return addTab.update(model, msg, c)[0];
}

function keys(model: AddModel, c: Ctx, ...names: string[]): AddModel {
  return names.reduce((m, name) => step(m, { type: "key", key: press(name) }, c), model);
}

function weightsRead(model: AddModel, c: Ctx): AddModel {
  return step(
    model,
    {
      type: "add/weightsRead",
      signature: model.weights.signature,
      entries: ENTRIES,
      warnings: [],
      spooled: [],
      remembered: {},
    },
    c,
  );
}

function imported(model: AddModel, c: Ctx, source: string, profiles: FilamentProfile[]) {
  return step(model, { type: "add/imported", source, profiles }, c);
}

describe("the Weights read", () => {
  it("is read again for another import file, so Review gets the new file's profiles", () => {
    const a = ctx({ values: { ...CONSOLE, source: "/data/a.json" } });
    let [model] = addTab.init(a, { query: "" });
    model = imported(model, a, "/data/a.json", [profile({ brand: "Acme", colorName: "Old" })]);
    model = weightsRead(keys(model, a, "right"), a);
    expect(model.page).toBe("review");
    expect(model.review.profiles.map((p) => p.colorName)).toEqual(["Old"]);

    const b = ctx({ values: { ...CONSOLE, source: "/data/b.json" } });
    model = keys(model, b, "esc");
    model = imported(model, b, "/data/b.json", [profile({ brand: "Zed", colorName: "New" })]);
    model = keys(model, b, "right");
    expect(model.page).toBe("weights");
    expect(model.weights.state).toBe("loading");
    model = weightsRead(model, b);
    expect(model.review.profiles.map((p) => p.colorName)).toEqual(["New"]);
    expect(model.review.profiles[0]?.coreWeight).toBe(180);
  });

  it("is read again when the diameter changes, even for the same filament IDs", () => {
    const thin = ctx({ values: CONSOLE });
    let [model] = addTab.init(thin, { query: "" });
    model = weightsRead(
      keys(model, thin, "enter", "down", "enter", "down", "space", "right"),
      thin,
    );
    expect(model.page).toBe("review");

    const thick = ctx({
      values: { ...CONSOLE, diameter: 2.85 },
      resources: {
        catalog: {
          state: "ready",
          value: catalog(PROFILES.map((p) => ({ ...p, diameter: 2.85 }))),
          at: 1,
        },
      },
    });
    model = keys(model, thick, "esc", "right");
    expect(model.weights.state).toBe("loading");
    model = weightsRead(model, thick);
    expect(model.review.profiles.map((p) => p.diameter)).toEqual([2.85]);
  });

  it("weighs the profiles ticked now, not the ones it was read with", () => {
    const before = ctx({ values: CONSOLE });
    let [model] = addTab.init(before, { query: "" });
    model = weightsRead(
      keys(model, before, "enter", "down", "enter", "down", "space", "right"),
      before,
    );
    const [first] = model.review.profiles;
    expect(first?.coreWeight).toBe(220);

    // SpoolmanDB reloaded: the same filament, its temperatures changed.
    const after = ctx({
      values: CONSOLE,
      resources: {
        catalog: {
          state: "ready",
          value: catalog(
            PROFILES.map((p) =>
              p.filamentId === first?.filamentId ? { ...p, nozzleTempMax: 235 } : p,
            ),
          ),
          at: 1,
        },
      },
    });
    model = keys(model, after, "esc", "right");
    expect(model.page).toBe("review");
    expect(model.review.profiles[0]?.nozzleTempMax).toBe(235);
    expect(model.review.profiles[0]?.coreWeight).toBe(220);
  });
});

describe("the Review plan's settings", () => {
  it("include the diameter and the source", () => {
    const base = values();
    expect(sameBasis(planBasis(base), planBasis({ ...base, diameter: 2.85 }))).toBe(false);
    expect(sameBasis(planBasis(base), planBasis({ ...base, source: "/data/a.json" }))).toBe(false);
  });
});
