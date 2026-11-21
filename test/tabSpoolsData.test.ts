// ABOUTME: Tests for what the Spools tab shows: the console connection, the summary line and the spool detail.
// ABOUTME: Pure functions over the console's spools, custom filaments and the sync check.

import { describe, expect, it } from "vitest";

import { inventoryRows } from "../src/spoolInventory.js";
import type { CheckSection } from "../src/syncCheck.js";
import type { CheckData, Resource } from "../src/tui/core/types.js";
import {
  barTone,
  compactDetail,
  consoleConnection,
  consoleUrl,
  nozzleRange,
  spoolDetail,
  spoolsSummary,
  swatchOf,
} from "../src/tui/tabs/spools/data.js";
import { FILAMENTS, spool, VALUES } from "./tabSpoolsFixtures.js";

const filaments = FILAMENTS;

describe("consoleConnection", () => {
  it("is the console from the settings, port as a number", () => {
    expect(consoleConnection(VALUES)).toEqual({
      host: "127.0.0.1",
      port: 80,
      securityKey: "SECRETKEY",
      https: false,
    });
  });

  it("is null when SpoolEase is skipped or the host or key is missing", () => {
    expect(consoleConnection({ ...VALUES, skipSpoolease: true })).toBeNull();
    expect(consoleConnection({ ...VALUES, host: " " })).toBeNull();
    expect(consoleConnection({ ...VALUES, securityKey: "" })).toBeNull();
  });

  it("gives the console's URL without the key", () => {
    const conn = consoleConnection({ ...VALUES, https: true, port: "8443" });
    expect(conn && consoleUrl(conn)).toBe("https://127.0.0.1:8443");
  });
});

describe("spoolsSummary", () => {
  const spools = [
    spool({ id: "1", currentWeight: 800 }), // 600 g left
    spool({ id: "2", currentWeight: 300 }), // 100 g left: low
    spool({ id: "3", currentWeight: null }), // not weighed
    spool({ id: "4", currentWeight: 200 }), // empty: not low too
  ];

  function check(sections: CheckSection[]): Resource<CheckData> {
    return { state: "ready", value: { sections, warnings: [], presets: [] }, at: 0 };
  }

  it("counts spools, grams left, and low, empty and unweighed spools", () => {
    const summary = spoolsSummary({ spools, filaments }, { state: "idle" });
    expect(summary).toMatchObject({ count: 4, leftGrams: 700, low: 1, empty: 1, unweighed: 1 });
  });

  it("reads the sync state from the check", () => {
    const data = { spools, filaments };
    expect(spoolsSummary(data, { state: "idle" }).sync).toEqual({ state: "idle" });
    expect(spoolsSummary(data, { state: "loading" }).sync).toEqual({ state: "checking" });
    expect(spoolsSummary(data, { state: "failed", error: "boom" }).sync).toEqual({
      state: "failed",
      error: "boom",
    });
    expect(spoolsSummary(data, check([])).sync).toEqual({ state: "ok" });
    const problem: CheckSection = {
      key: "csvOnly",
      title: "t",
      why: "w",
      problem: true,
      items: ["a", "b"],
    };
    const note: CheckSection = { ...problem, key: "noCode", problem: false, items: ["c"] };
    expect(spoolsSummary(data, check([problem, note])).sync).toEqual({
      state: "problems",
      problems: 2,
    });
    expect(spoolsSummary(data, check([note])).sync).toEqual({ state: "ok" });
  });
});

describe("barTone", () => {
  it("is red under 10%, yellow under 25%, green above, none when unknown", () => {
    expect(barTone(0.05)).toBe("failed");
    expect(barTone(0.2)).toBe("warning");
    expect(barTone(0.25)).toBe("ok");
    expect(barTone(null)).toBeUndefined();
  });
});

describe("swatchOf and nozzleRange", () => {
  it("gives the first color as #RRGGBB, or nothing for a bad code", () => {
    expect(swatchOf(["BC2726FF", "000000FF"])).toBe("#BC2726");
    expect(swatchOf(["zz"])).toBeUndefined();
    expect(swatchOf([])).toBeUndefined();
  });

  it("writes the nozzle range for people", () => {
    expect(nozzleRange({ name: "", nozzleTempMin: 190, nozzleTempMax: 230 })).toBe("190–230°C");
    expect(nozzleRange({ name: "", nozzleTempMin: 220, nozzleTempMax: 220 })).toBe("220°C");
    expect(nozzleRange({ name: "", nozzleTempMin: null, nozzleTempMax: 220 })).toBe("220°C");
    expect(nozzleRange({ name: "", nozzleTempMin: null, nozzleTempMax: null })).toBe("");
    expect(nozzleRange(undefined)).toBe("");
  });
});

describe("spoolDetail", () => {
  it("names the spool and lists what's left, weights, place, tag, dates, note and temperatures", () => {
    const added = Date.UTC(2026, 9, 30, 12) / 1000;
    const [row] = inventoryRows(
      [
        spool({
          id: "14",
          currentWeight: 764,
          location: "AMS 1 · slot 2",
          tagId: "04AABB",
          addedTime: added,
          note: "dry first",
        }),
      ],
      filaments,
      "",
      "newest",
    );
    if (!row) throw new Error("no row");
    const detail = spoolDetail(row, filaments);
    expect(detail.title).toBe("Acme PETG Red");
    expect(detail.subtitle).toBe("Acme · PETG · P1111111");
    expect(detail.swatch).toBe("#BC2726");
    expect(detail.rows).toEqual([
      { label: "Left", value: "564 g of 1000 g · 56%", tone: "ok" },
      { label: "Empty", value: "200 g spool" },
      { label: "Location", value: "AMS 1 · slot 2" },
      { label: "Nozzle", value: "230–250°C" },
      { label: "Tag", value: "04AABB", dim: true },
      { label: "Added", value: "2026-10-30" },
      { label: "Note", value: "dry first" },
    ]);
  });

  it("says what isn't known yet instead of leaving gaps", () => {
    const [row] = inventoryRows(
      [spool({ labelWeight: null, coreWeight: null, slicerFilament: "", subtype: "HF" })],
      filaments,
      "",
      "newest",
    );
    if (!row) throw new Error("no row");
    const detail = spoolDetail(row, filaments);
    expect(detail.subtitle).toBe("Acme · PETG HF · no filament code");
    expect(detail.rows).toEqual([
      { label: "Left", value: "not weighed yet", dim: true },
      { label: "Empty", value: "unknown, SpoolEase learns it on the first full weigh", dim: true },
      { label: "Location", value: "not placed", dim: true },
      { label: "Tag", value: "none", dim: true },
    ]);
  });

  it("says empty, in red, for a spool with nothing left", () => {
    const [row] = inventoryRows([spool({ currentWeight: 200 })], filaments, "", "newest");
    if (!row) throw new Error("no row");
    expect(spoolDetail(row, filaments).rows[0]).toEqual({
      label: "Left",
      value: "empty (0 g of 1000 g)",
      tone: "failed",
    });
  });
});

describe("compactDetail", () => {
  it("puts the spool in three lines for a panel under the list", () => {
    const [row] = inventoryRows(
      [
        spool({
          id: "14",
          currentWeight: 764,
          location: "AMS 1",
          tagId: "04AABB",
          addedTime: Date.UTC(2026, 9, 30, 12) / 1000,
        }),
      ],
      filaments,
      "",
      "newest",
    );
    if (!row) throw new Error("no row");
    expect(compactDetail(row, filaments)).toEqual([
      { label: "Left", value: "564 g of 1000 g · 56% · 200 g spool", tone: "ok" },
      { label: "Place", value: "AMS 1 · tag 04AABB · added 2026-10-30" },
      { label: "Filament", value: "Acme · PETG · P1111111 · 230–250°C" },
    ]);
  });

  it("says what isn't known yet", () => {
    const [row] = inventoryRows(
      [spool({ currentWeight: null, coreWeight: null, slicerFilament: "" })],
      filaments,
      "",
      "newest",
    );
    if (!row) throw new Error("no row");
    expect(compactDetail(row, filaments)).toEqual([
      { label: "Left", value: "not weighed yet · empty spool unknown", dim: true },
      { label: "Place", value: "not placed · no tag", dim: true },
      { label: "Filament", value: "Acme · PETG · no filament code" },
    ]);
  });
});
